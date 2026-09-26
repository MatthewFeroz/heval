import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import type { Server } from 'node:http'
import { request } from 'node:http'
import { startProviderSetup } from './provider-setup'
import { connectMerge } from './merge'

const servers: Server[] = [], directories: string[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>(done => server.close(() => done())) }
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})
async function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'heval-provider-')); directories.push(directory)
  const calls: string[] = []
  const { server, url } = await startProviderSetup(directory, resolve(import.meta.dirname, '../runner-task'), 0, (state, key) => connectMerge(state, key, async value => {
    calls.push(value)
    if (value !== 'test-secret') throw new Error('Secret must never appear: ' + value)
    return { schemaVersion: 1, fetchedAt: new Date().toISOString(), source: 'test', models: [{ model: 'test/model', displayName: 'Test', creator: 'test', vendors: [{ vendor: 'test', status: 'available', supportsToolCalling: true, supportsReasoning: false, contextWindow: null, maxOutputTokens: null, inputPerMillion: null, outputPerMillion: null, cacheReadPerMillion: null }] }] }
  }))
  servers.push(server)
  const parsed = new URL(url), token = parsed.hash.slice('#token='.length), origin = parsed.origin
  const headers = { Authorization: `Bearer ${token}`, Origin: origin, 'Content-Type': 'application/json' }
  const post = (path: string, body: unknown) => fetch(origin + path, { method: 'POST', headers, body: JSON.stringify(body) })
  return { directory, calls, origin, headers, post }
}

test('local setup saves a verified key, exposes models without secrets, and prepares a real smoke profile', async () => {
  const s = await setup()
  const page = await fetch(s.origin)
  expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
  expect(await page.text()).toContain('type="password"')
  expect((await s.post('/api/connect', { key: 'test-secret' })).status).toBe(200)
  const status = await fetch(s.origin + '/api/status', { headers: s.headers }).then(r => r.json())
  expect(status.connected).toBe(true); expect(status.models).toEqual(['test/model'])
  expect(JSON.stringify(status)).not.toContain('test-secret')
  expect(JSON.parse(readFileSync(join(s.directory, 'merge.json'), 'utf8')).key).toBe('test-secret')
  expect((await s.post('/api/profiles', { model: 'test/model', harnesses: ['codex'] })).status).toBe(200)
  expect(existsSync(join(s.directory, 'merge-codex.json'))).toBe(true)
  expect((await s.post('/api/profiles', { model: 'test/model', harnesses: ['codex'] })).status).toBe(200)
  expect(s.calls).toEqual(['test-secret'])
})

test('invalid input and provider rejection preserve the saved key and do not echo secrets', async () => {
  const s = await setup()
  await s.post('/api/connect', { key: 'test-secret' })
  for (const key of ['', 'Bearer secret', 'a'.repeat(4097)]) expect((await s.post('/api/connect', { key })).status).toBe(400)
  const rejected = await s.post('/api/connect', { key: 'rejected-secret' })
  expect(rejected.status).toBe(400); expect(await rejected.text()).not.toContain('rejected-secret')
  expect(JSON.parse(readFileSync(join(s.directory, 'merge.json'), 'utf8')).key).toBe('test-secret')
  expect((await s.post('/api/connect', { key: 'a'.repeat(9000) })).status).toBe(413)
  expect((await s.post('/api/profiles', { model: 'unknown', harnesses: ['codex'] })).status).toBe(400)
})

test('only an authenticated page can keep its setup session alive without accessing the worker', async () => {
  const s = await setup()
  expect((await fetch(s.origin + '/api/heartbeat')).status).toBe(403)
  const response = await fetch(s.origin + '/api/heartbeat', { headers: s.headers })
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ active: true })
  expect(s.calls).toEqual([])
})

test('an open page outlives the idle deadline, then the server expires after heartbeats stop', async () => {
  const { server, url } = await startProviderSetup('', '', 0, undefined, undefined, undefined, 1000)
  const parsed = new URL(url)
  const headers = { Authorization: `Bearer ${parsed.hash.slice(7)}` }
  try {
    for (let i = 0; i < 3; i++) {
      await Bun.sleep(600)
      expect((await fetch(parsed.origin + '/api/heartbeat', { headers })).status).toBe(200)
    }
    expect(server.listening).toBe(true)
    await new Promise<void>(done => server.once('close', done))
    expect(server.listening).toBe(false)
  } finally {
    server.closeAllConnections(); server.close()
  }
})

test('setup requires its capability and same origin and rejects DNS rebinding hosts', async () => {
  const s = await setup()
  expect((await fetch(s.origin + '/api/status')).status).toBe(403)
  for (const headers of [ { ...s.headers, Authorization: 'Bearer wrong' }, { ...s.headers, Origin: 'https://evil.example' }, { ...s.headers, 'Sec-Fetch-Site': 'cross-site' }, { ...s.headers, 'Content-Type': 'text/plain' } ]) {
    expect((await fetch(s.origin + '/api/connect', { method: 'POST', headers, body: JSON.stringify({ key: 'test-secret' }) })).status).toBe(403)
  }
  const status = await new Promise<number>(done => { const req = request(s.origin, { headers: { Host: 'evil.example' } }, res => { res.resume(); done(res.statusCode!) }); req.end() })
  expect(status).toBe(403); expect(s.calls).toEqual([])
  expect(existsSync(join(s.directory, 'merge.json'))).toBe(false)
})

test('managed worker pairing is capability protected, validates input, and hides adapter errors', async () => {
  const calls: string[] = []
  const { server, url } = await startProviderSetup('', '', 0, undefined, {
    status: async () => ({ connected: false, models: [], worker: { paired: false, ready: true } }),
    connect: async () => { throw new Error('secret-from-provider') },
    profiles: async () => ({ profiles: ['merge-codex'] }),
    pair: async (_url, code) => { calls.push(code); throw new Error(code) },
  })
  servers.push(server)
  const parsed = new URL(url), headers = { Authorization: `Bearer ${parsed.hash.slice(7)}`, Origin: parsed.origin, 'Content-Type': 'application/json' }
  const post = (body: unknown) => fetch(parsed.origin + '/api/pair', { method: 'POST', headers, body: JSON.stringify(body) })
  expect((await fetch(parsed.origin + '/api/status')).status).toBe(403)
  expect((await post({ code: 'bad', url: 'https://example.com' })).status).toBe(400)
  expect(calls).toHaveLength(0)
  const code = 'a'.repeat(64)
  const response = await post({ code, url: 'https://test.convex.cloud' })
  expect(response.status).toBe(400)
  expect(await response.text()).not.toContain(code)
  expect(calls).toEqual([code])
  const status = await fetch(parsed.origin + '/api/status', { headers }).then(r => r.json())
  expect(status.worker).toEqual({ paired: false, ready: true })
})
