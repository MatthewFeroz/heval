import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { createRunner } from './runner'
import { createApi } from './api'
import { createAuthenticator } from './auth'
import { containerArgs, type WorkerBackend } from './docker'
import { Recording } from './recording'
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'

const directories: string[] = []
afterEach(async () => {
  for (const dir of directories.splice(0)) {
    const target = resolve(dir)
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('heval-test-')) throw new Error('Unsafe test cleanup path')
    await rm(target, { recursive: true, force: true })
  }
})
async function setup(overrides: Partial<Parameters<typeof createRunner>[0]> = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'heval-test-'))
  directories.push(directory)
  let finish!: (code: number) => void
  let output!: (data: string) => void
  let stops = 0
  let cleaned = 0
  let onStarted!: () => void
  const started = new Promise<void>(resolve => { onStarted = resolve })
  const backend: WorkerBackend = {
    start(_id, _harness, callback) {
      output = callback; onStarted()
      return { exited: new Promise<number>((resolve) => { finish = resolve }), stop: async () => { stops++; finish(137) } }
    },
    grade(_id, callback) { callback('pinned tests passed'); return { exited: Promise.resolve(0), stop: async () => {} } },
    async cleanup() { cleaned++ },
  }
  const runner = createRunner({ backend, directory, maxConcurrent: 2, maxPerUser: 1,
    timeoutMs: 500, gradeTimeoutMs: 100, maxOutputBytes: 8192, model: 'test', ...overrides })
  await runner.ready
  return { runner, directory, started, finish: (code: number) => finish(code), output: (data: string) => output(data),
    stops: () => stops, cleaned: () => cleaned }
}

test('all run routes require authentication and enforce ownership before upgrading or mutating', async () => {
  const { runner } = await setup()
  const run = { id: 'alice-run', ownerId: 'alice', harness: 'codex' as const, model: 'test', gateway: 'merge-gateway' as const,
    status: 'complete' as const, startedAt: '', chunks: [{ at: 0, data: 'private transcript' }] }
  runner.runs.set(run.id, run)
  const api = createApi(runner, async (req) => {
    const userId = req.headers.get('x-test-user'); return userId ? { userId } : null
  }, true)
  for (const [path, method] of [['/api/runs', 'GET'], ['/api/runs', 'POST'], ['/api/runs/alice-run', 'GET'],
    ['/api/runs/alice-run', 'DELETE'], ['/api/runs/alice-run/grade', 'POST'], ['/api/runs/alice-run/stream', 'GET']]) {
    const response = await api(new Request(`http://localhost${path}`, { method }), () => { throw new Error('must not upgrade') })
    expect(response?.status).toBe(401)
    if (path === '/api/runs') continue
    const foreign = await api(new Request(`http://localhost${path}`, { method, headers: { 'x-test-user': 'bob' } }), () => { throw new Error('must not upgrade') })
    expect(foreign?.status).toBe(404)
  }
  const list = (user: string) => api(new Request('http://localhost/api/runs', { headers: { 'x-test-user': user } }), () => false)
  expect(await (await list('bob'))?.json()).toEqual([])
  const own = await (await list('alice'))?.json()
  expect(own).toHaveLength(1)
  expect(JSON.stringify(own)).not.toContain('private transcript')
  expect((await api(new Request('http://localhost/api/runs/alice-run', { headers: { 'x-test-user': 'alice' } }), () => false))?.status).toBe(200)
  expect(await createAuthenticator()(new Request('http://localhost', { headers: { authorization: 'Bearer forged' } }))).toBeNull()
})

test('capacity is reserved synchronously per owner and globally, then released after cleanup', async () => {
  const { runner, finish, cleaned, started } = await setup({ maxConcurrent: 1 })
  const run = runner.startRun('codex', 'alice')
  expect(() => runner.startRun('codex', 'alice')).toThrow('capacity')
  expect(() => runner.startRun('codex', 'bob')).toThrow('capacity')
  await started; finish(0); await runner.wait(run.id)
  expect(run.grade?.passed).toBe(true)
  expect(cleaned()).toBe(1)
  const next = runner.startRun('codex', 'bob')
  runner.cancelRun(next); await runner.wait(next.id)
  expect(next.status).toBe('cancelled')
})

test('timeouts stop the worker and clean up resources', async () => {
  const { runner, stops, cleaned } = await setup({ timeoutMs: 10 })
  const run = runner.startRun('codex', 'alice')
  await runner.wait(run.id)
  expect(run.status).toBe('timed-out'); expect(stops()).toBe(1); expect(cleaned()).toBe(1)
})

test('cancellation does not turn into success when the process exits', async () => {
  const { runner, stops, started } = await setup()
  const run = runner.startRun('codex', 'alice')
  await started
  expect(runner.cancelRun(run)).toBe(true)
  await runner.wait(run.id)
  expect(run.status).toBe('cancelled'); expect(stops()).toBe(1); expect(run.grade).toBeUndefined()
})

test('output limit stops noisy workers', async () => {
  const { runner, output, started } = await setup({ maxOutputBytes: 32 })
  const run = runner.startRun('codex', 'alice')
  await started; output('x'.repeat(100)); await runner.wait(run.id)
  expect(run.error).toBe('Output limit exceeded'); expect(run.chunks).toHaveLength(0)
})

test('recordings preserve ordered events, redact split credentials, and keep summaries small', async () => {
  const { runner, output, finish, directory, started } = await setup({ secret: 'secret-key' })
  const run = runner.startRun('codex', 'alice')
  await started; output('before secr'); output('et-key after'); finish(0)
  await runner.wait(run.id)
  const events = await readFile(join(directory, `${run.id}.jsonl`), 'utf8')
  const data = events.trim().split('\n').map((line) => JSON.parse(line))
  expect(data.filter((e) => e.type === 'data').map((e) => e.data).join('')).toBe('before [REDACTED] afterpinned tests passed')
  expect(events).not.toContain('secret-key'); expect(data.at(-1).type).toBe('exit')
  const summary = JSON.parse(await readFile(join(directory, `${run.id}.json`), 'utf8'))
  expect(summary.chunks).toBeUndefined(); expect(summary.grade.passed).toBe(true)
})

test('periodic flush appends only new events and updates the summary', async () => {
  const { directory } = await setup()
  let status = 'running'
  const recording = new Recording(directory, 'append', () => ({ status }), () => {}, 10)
  recording.append({ n: 1 }); await recording.flush()
  recording.append({ n: 2 }); status = 'complete'; await recording.close()
  expect(await readFile(join(directory, 'append.jsonl'), 'utf8')).toBe('{"n":1}\n{"n":2}\n')
  expect(JSON.parse(await readFile(join(directory, 'append.json'), 'utf8')).status).toBe('complete')
})

test('Docker policy isolates agents and uses a networkless credential-free grader', () => {
  const args = containerArgs('test', 'heval-worker:local', false)
  expect(args).toContain('--read-only'); expect(args).toContain('--cap-drop=ALL')
  expect(args).toContain('--security-opt=no-new-privileges'); expect(args).toContain('--pids-limit=128')
  expect(args.join(' ')).not.toContain('type=bind'); expect(args.join(' ')).not.toContain('docker.sock')
  const grade = containerArgs('test', 'heval-worker:local', true)
  expect(grade).toContain('--network=none'); expect(grade.join(' ')).not.toContain('API_KEY')
  expect(grade.join(' ')).toContain('/candidate,readonly')
})

test('verified tokens require the expected issuer, client, expiry, and user subject', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256')
  const keys = createLocalJWKSet({ keys: [await exportJWK(publicKey)] })
  const auth = createAuthenticator('client-test', 'api.workos.com', keys)
  const base = { client_id: 'client-test', sub: 'alice', iss: 'https://api.workos.com', exp: Math.floor(Date.now() / 1000) + 60 }
  const token = (payload: object) => new SignJWT({ ...payload }).setProtectedHeader({ alg: 'RS256' }).sign(privateKey)
  for (const change of [{ sub: '' }, { sub: undefined }, { exp: undefined }, { exp: 1 }, { client_id: 'other' }, { iss: 'https://other' }]) {
    expect(await auth(new Request('http://localhost', { headers: { authorization: `Bearer ${await token({ ...base, ...change })}` } }))).toBeNull()
  }
  const valid = await token(base)
  expect(await auth(new Request('http://localhost', { headers: { authorization: `Bearer ${valid}` } }))).toEqual({ userId: 'alice' })
  expect(await auth(new Request('http://localhost', { headers: { 'sec-websocket-protocol': `heval, heval-auth.${valid}` } }))).toEqual({ userId: 'alice' })
  expect(await auth(new Request('http://localhost', { headers: { authorization: `Bearer ${valid.slice(0, -10)}invalid` } }))).toBeNull()
})

test('per-user capacity leaves room for a different owner', async () => {
  const { runner } = await setup()
  const alice = runner.startRun('codex', 'alice')
  expect(() => runner.startRun('codex', 'alice')).toThrow('capacity')
  const bob = runner.startRun('codex', 'bob')
  expect(bob.ownerId).toBe('bob')
  runner.cancelRun(alice); runner.cancelRun(bob)
  await runner.shutdown()
})

test('failed starts cannot fall back to host execution and clean up their slot', async () => {
  let cleaned = false
  const { runner } = await setup({ backend: {
    start() { throw new Error('Docker missing') },
    grade() { throw new Error('must not grade') },
    async cleanup() { cleaned = true },
  } })
  const run = runner.startRun('codex', 'alice')
  await runner.wait(run.id)
  expect(run.status).toBe('failed'); expect(cleaned).toBe(true)
  expect(run.error).toContain('Worker unavailable')
})

test('a failed cleanup blocks new launches', async () => {
  const { runner } = await setup({ backend: {
    start() { return { exited: Promise.resolve(1), stop: async () => {} } },
    grade() { throw new Error('must not grade') },
    async cleanup() { throw new Error('daemon offline') },
  } })
  const run = runner.startRun('codex', 'alice'); await runner.wait(run.id)
  expect(run.error).toContain('cleanup failed')
  expect(() => runner.startRun('codex', 'bob')).toThrow('cleanup failed')
})

test('grader has its own deadline and cannot publish a grade after timeout', async () => {
  let stopped = false
  const { runner } = await setup({ gradeTimeoutMs: 10, backend: {
    start() { return { exited: Promise.resolve(0), stop: async () => {} } },
    grade() {
      let finish!: (code: number) => void
      return { exited: new Promise<number>((resolve) => { finish = resolve }), stop: async () => { stopped = true; finish(137) } }
    },
    async cleanup() {},
  } })
  const run = runner.startRun('codex', 'alice'); await runner.wait(run.id)
  expect(run.status).toBe('timed-out'); expect(stopped).toBe(true); expect(run.grade).toBeUndefined()
})

test('recording directory failures stop execution without unhandled rejections', async () => {
  const { directory } = await setup()
  const file = join(directory, 'file')
  await writeFile(file, 'not a directory')
  let reported = false
  const recording = new Recording(join(file, 'recordings'), 'failure', () => ({}), () => { reported = true }, 10)
  recording.append({ data: 'sample' })
  await expect(recording.close()).rejects.toThrow()
  expect(reported).toBe(true)
})
