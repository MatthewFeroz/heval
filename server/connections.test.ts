import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createConnectionStore, connectionEncryptionKey } from './connections'
import { createInferenceProxy } from './inference-proxy'
import { createRunner } from './runner'
import { createApi } from './api'
import type { Catalog } from '../harbor/gateway/catalog'
import type { RunAccess } from './docker'

const catalog: Catalog = { schemaVersion: 1, fetchedAt: new Date().toISOString(), source: 'test', models: [
  { model: 'nvidia/lightning', displayName: 'Lightning', creator: 'nvidia', vendors: [{ vendor: 'nvidia', status: 'available', supportsToolCalling: true, supportsReasoning: true, contextWindow: null, maxOutputTokens: null, inputPerMillion: null, outputPerMillion: null, cacheReadPerMillion: null }] },
  { model: 'unsupported', displayName: 'Unsupported', creator: 'test', vendors: [] },
] }
const cleanups: (() => Promise<unknown> | unknown)[] = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'heval-connections-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  const key = connectionEncryptionKey(directory)
  const store = createConnectionStore(directory, key, async key => { if (key === 'invalid') throw new Error('catalog fetch failed: 401'); return catalog })
  cleanups.push(() => store.close())
  return { directory, key, store }
}
const request = (token: string, body: object = { model: 'nvidia/lightning', messages: [] }, path = '/api/inference/chat/completions') => new Request(`http://localhost${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

test('keys persist encrypted, remain isolated by owner, and survive restart without entering metadata', async () => {
  const { directory, key, store } = await setup()
  const status = await store.validate('alice', 'private-alice-credential')
  expect(status.models).toEqual(['nvidia/lightning'])
  expect(JSON.stringify(status)).not.toContain('private-alice-credential')
  expect(store.status('bob').connected).toBe(false)
  expect(() => store.secret('bob')).toThrow('Connect Merge')
  expect((await readFile(join(directory, 'connections.sqlite'))).includes(Buffer.from('private-alice-credential'))).toBe(false)
  expect((await stat(join(directory, 'connection-encryption.key'))).mode & 0o777).toBe(0o600)
  expect(connectionEncryptionKey(directory).equals(key)).toBe(true)
  expect(() => connectionEncryptionKey(directory, undefined, true)).toThrow('HEVAL_CONNECTION_ENCRYPTION_KEY')
  const reopened = createConnectionStore(directory, key); cleanups.push(() => reopened.close())
  expect(reopened.secret('alice')).toBe('private-alice-credential')
  await expect(store.validate('alice', 'invalid')).rejects.toThrow('rejected this key')
  expect(store.secret('alice')).toBe('private-alice-credential')
  store.remove('alice')
  expect(reopened.status('alice').connected).toBe(false)
})

test('validation is throttled and overlapping updates cannot resurrect a deleted connection', async () => {
  const { directory, key, store } = await setup()
  for (let index = 0; index < 10; index++) await expect(store.validate('alice', 'invalid')).rejects.toThrow('rejected')
  await expect(store.validate('alice', 'invalid')).rejects.toThrow('Too many')
  let complete!: (value: Catalog) => void
  const blocked = createConnectionStore(directory, key, () => new Promise(resolve => { complete = resolve }))
  cleanups.push(() => blocked.close())
  const pending = blocked.validate('bob', 'bob-key')
  expect(() => blocked.remove('bob')).toThrow('Wait for connection validation')
  await expect(blocked.validate('bob', 'another-key')).rejects.toThrow('already in progress')
  complete(catalog); await pending
  blocked.remove('bob'); expect(blocked.status('bob').connected).toBe(false)
})

test('run proxy hides the provider key, restricts model and endpoint, caps requests, and revokes leases', async () => {
  const { store } = await setup()
  await store.validate('alice', 'private-alice-credential')
  const seen: { headers: Headers; body: Record<string, unknown>; url: string }[] = []
  const upstream = (async (url: string, init: RequestInit) => {
    seen.push({ url, headers: new Headers(init.headers), body: JSON.parse(String(init.body)) })
    return Response.json({ choices: [] })
  }) as typeof fetch
  const proxy = createInferenceProxy(store, 'https://heval.test/api/inference', upstream)
  const lease = proxy.issue('alice', 'nvidia/lightning', 60000); cleanups.push(lease.release)
  expect(lease.apiKey).not.toBe('private-alice-credential')
  expect((await proxy.handle(request(lease.apiKey, { model: 'different', messages: [] }))).status).toBe(400)
  expect((await proxy.handle(request(lease.apiKey, {}, '/api/inference/models'))).status).toBe(404)
  const response = await proxy.handle(request(lease.apiKey, { model: 'nvidia/lightning', messages: [], max_tokens: 100000, base_url: 'https://attacker.invalid', vendor: 'unapproved' }))
  await response.text()
  expect(seen[0].url).toBe('https://api-gateway.merge.dev/v1/openai/chat/completions')
  expect(seen[0].headers.get('authorization')).toBe('Bearer private-alice-credential')
  expect(seen[0].body.max_tokens).toBe(8192)
  expect(seen[0].body.base_url).toBeUndefined(); expect(seen[0].body.vendor).toBeUndefined()
  for (let index = 1; index < 40; index++) await (await proxy.handle(request(lease.apiKey))).text()
  expect((await proxy.handle(request(lease.apiKey))).status).toBe(429)
  proxy.revokeOwner('bob'); expect((await proxy.handle(request(lease.apiKey))).status).toBe(429)
  proxy.revokeOwner('alice'); expect((await proxy.handle(request(lease.apiKey))).status).toBe(401)
})

test('proxy rejects concurrent requests, aborts on revocation, expires tokens and suppresses upstream errors', async () => {
  const { store } = await setup(); await store.validate('alice', 'private-key')
  let signal: AbortSignal | undefined
  let finish!: (value: Response) => void
  const proxy = createInferenceProxy(store, 'http://localhost/api/inference', (async (_url: string, init: RequestInit) => {
    signal = init.signal!; return new Promise<Response>(resolve => { finish = resolve })
  }) as typeof fetch)
  const lease = proxy.issue('alice', 'nvidia/lightning', 60000); cleanups.push(lease.release)
  const pending = proxy.handle(request(lease.apiKey))
  await new Promise(resolve => setTimeout(resolve, 1))
  expect((await proxy.handle(request(lease.apiKey))).status).toBe(429)
  proxy.revokeOwner('alice'); expect(signal?.aborted).toBe(true)
  finish(new Response('private-key', { status: 401 }))
  expect(await (await pending).text()).not.toContain('private-key')
  const expired = proxy.issue('alice', 'nvidia/lightning', 1); cleanups.push(expired.release)
  await new Promise(resolve => setTimeout(resolve, 5))
  expect((await proxy.handle(request(expired.apiKey))).status).toBe(401)
})

test('connection APIs require identity, restrict models, launch with a temporary token, and delete without deleting results', async () => {
  const { directory, store } = await setup()
  const proxy = createInferenceProxy(store, 'http://localhost/api/inference')
  let access: RunAccess | undefined
  const runner = createRunner({ directory: join(directory, 'runs'), model: 'nvidia/lightning', maxConcurrent: 1, maxPerUser: 1, timeoutMs: 1000, gradeTimeoutMs: 1000, maxOutputBytes: 8192, backend: {
    start(_id, _harness, output, _config, credentials) { access = credentials; output(credentials!.apiKey); return { exited: Promise.resolve(0), stop: async () => {} } },
    grade() { return { exited: Promise.resolve(0), stop: async () => {} } }, cleanup: async () => {},
  } }); cleanups.push(() => runner.shutdown()); await runner.ready
  const api = createApi(runner, async req => req.headers.has('x-user') ? { userId: req.headers.get('x-user')! } : null, true, false, new Set(['alice', 'bob']), { store, proxy })
  const call = (path: string, user: string | null = 'alice', method = 'GET', body?: object) => api(new Request(`http://localhost/api/${path}`, { method, headers: { ...(user ? { 'x-user': user } : {}), 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }), () => false)
  expect((await call('connections/merge-gateway', null))?.status).toBe(401)
  expect((await call('connections/merge-gateway', 'outsider', 'POST', { action: 'connect', apiKey: 'key' }))?.status).toBe(403)
  expect((await (await call('config'))!.json()).canRun).toBe(false)
  expect((await call('connections/merge-gateway', 'alice', 'POST', { action: 'connect', apiKey: 'private-key' }))?.status).toBe(200)
  expect((await (await call('connections/merge-gateway', 'bob'))!.json()).connected).toBe(false)
  expect((await (await call('config'))!.json()).models).toEqual(['nvidia/lightning'])
  expect((await call('runs', 'alice', 'POST', { harness: 'pi-agent', model: 'unapproved' }))?.status).toBe(400)
  const response = await call('runs', 'alice', 'POST', { harness: 'pi-agent', model: 'nvidia/lightning' })
  expect(response?.status).toBe(202)
  const { id } = await response!.json(); await runner.wait(id)
  expect(access?.apiKey).not.toBe('private-key')
  expect(access?.baseUrl).toBe('http://localhost/api/inference')
  expect(JSON.stringify(await runner.getRun(id))).not.toContain(access!.apiKey)
  expect((await proxy.handle(request(access!.apiKey))).status).toBe(401)
  expect((await call('connections/merge-gateway', 'alice', 'DELETE'))?.status).toBe(200)
  expect(runner.runs.has(id)).toBe(true)
  expect((await (await call('config'))!.json()).canRun).toBe(false)
})
