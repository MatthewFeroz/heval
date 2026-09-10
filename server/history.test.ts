import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createRunner } from './runner'
import { createApi } from './api'
import { exportRuns } from './run-export'
import { createSignupStore } from './signup'
import { deploymentPolicy } from './deployment'
import type { Run } from './types'
import type { WorkerBackend } from './docker'

const directories: string[] = []
const instances: ReturnType<typeof createRunner>[] = []
afterEach(async () => {
  await Promise.all(instances.splice(0).map(runner => runner.shutdown()))
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})
async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'heval-history-test-'))
  directories.push(path)
  return path
}
function runnerAt(path: string, backend?: WorkerBackend) {
  const runner = createRunner({ directory: path, backend: backend ?? {
    start(_id, _harness, output) { output('actual worker output'); return { exited: Promise.resolve(0), stop: async () => {} } },
    grade(_id, output) { output('grader output'); return { exited: Promise.resolve(0), stop: async () => {} } },
    cleanup: async () => {},
  }, maxConcurrent: 2, maxPerUser: 1, maxDailyPerUser: 2, timeoutMs: 1000, gradeTimeoutMs: 1000,
  maxOutputBytes: 8192, model: 'nvidia/lightning', allowedModels: ['nvidia/lightning', 'nvidia/super'] })
  instances.push(runner)
  return runner
}
const identity = async (request: Request) => ({ userId: request.headers.get('x-test-user') || 'alice' })
const call = (api: ReturnType<typeof createApi>, path: string, user = 'alice', method = 'GET', body?: object) => api(new Request(`http://localhost${path}`, {
  method, headers: { 'x-test-user': user, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
}), () => false)

test('completed history, transcripts, ownership and daily limits survive restart', async () => {
  const path = await directory()
  const first = runnerAt(path); await first.ready
  const run = first.startRun('pi-agent', 'alice', { model: 'nvidia/super', timeoutMs: 700 })
  await first.wait(run.id)
  const next = first.startRun('pi-agent', 'alice'); await first.wait(next.id)
  expect(run.chunks).toHaveLength(0) // Memory eviction does not remove the recording.
  await first.shutdown()
  const restored = runnerAt(path); await restored.ready
  expect(restored.runs.size).toBe(2)
  expect((await restored.getRun(run.id))?.chunks.map(chunk => chunk.data).join('')).toContain('actual worker output')
  expect(restored.runs.get(run.id)?.model).toBe('nvidia/super')
  expect(() => restored.startRun('pi-agent', 'alice')).toThrow('Daily')
  const api = createApi(restored, identity, true)
  expect((await call(api, `/api/runs/${run.id}`, 'bob'))?.status).toBe(404)
  expect((await call(api, `/api/runs/export?ids=${run.id}`, 'bob'))?.status).toBe(404)
  const exported = await (await call(api, `/api/runs/${run.id}/export`))?.json()
  expect(exported.rows[0].model).toBe('nvidia/super')
  expect(exported.rows[0].passed).toBe(1)
  expect(exported.rows[0].costUsd).toBeNull()
  expect(exported.rows[0].totalTokens).toBeNull()
  const increment = await (await call(api, `/api/runs/${run.id}?after=1`))?.json()
  expect(increment.chunks).toHaveLength(1)
  expect((await call(api, `/api/runs/${run.id}?after=-1`))?.status).toBe(400)
})

test('recovery cleans interrupted workers and persists an honest terminal status', async () => {
  const path = await directory()
  const id = crypto.randomUUID()
  await writeFile(join(path, `${id}.json`), JSON.stringify({ id, ownerId: 'alice', harness: 'pi-agent', model: 'nvidia/lightning', status: 'running', startedAt: new Date().toISOString() }))
  let cleaned = ''
  const runner = runnerAt(path, { start() { throw Error('no launch') }, grade() { throw Error('no grade') }, async cleanup(value) { cleaned = value } })
  await runner.ready
  expect(cleaned).toBe(id)
  expect(runner.runs.get(id)?.status).toBe('failed')
  expect(runner.runs.get(id)?.error).toContain('restart')
  expect(JSON.parse(await readFile(join(path, `${id}.json`), 'utf8')).finishedAt).toBeTruthy()
  expect(() => exportRuns([runner.runs.get(id)!])).toThrow('Only graded')
})

test('failed recovery cleanup remains pending across another restart', async () => {
  const path = await directory()
  const id = crypto.randomUUID()
  await writeFile(join(path, `${id}.json`), JSON.stringify({ id, ownerId: 'alice', harness: 'pi-agent', model: 'nvidia/lightning', status: 'running', startedAt: new Date().toISOString() }))
  const backend = { start() { throw Error('no launch') }, grade() { throw Error('no grade') }, async cleanup() { throw Error('offline') } }
  const first = runnerAt(path, backend); await first.ready
  expect(() => first.startRun('pi-agent', 'alice')).toThrow('cleanup')
  const second = runnerAt(path, backend); await second.ready
  expect(() => second.startRun('pi-agent', 'alice')).toThrow('cleanup')
})

test('configuration restrictions and invitation checks happen before launching', async () => {
  const runner = runnerAt(await directory()); await runner.ready
  const api = createApi(runner, identity, true, false, new Set(['alice']))
  expect((await call(api, '/api/runs', 'bob', 'POST', { harness: 'pi-agent' }))?.status).toBe(403)
  for (const config of [{ model: 'unapproved' }, { task: '../other' }, { timeoutMs: 1001 }, { timeoutMs: -1 }]) {
    expect((await call(api, '/api/runs', 'alice', 'POST', { harness: 'pi-agent', ...config }))?.status).toBe(400)
  }
  expect(runner.runs.size).toBe(0)
})

test('accepted runs have a durable summary before the API responds', async () => {
  const path = await directory()
  const runner = runnerAt(path)
  const response = await call(createApi(runner, identity, true), '/api/runs', 'alice', 'POST', { harness: 'pi-agent' })
  expect(response?.status).toBe(202)
  const { id } = await response!.json()
  expect(JSON.parse(await readFile(join(path, `${id}.json`), 'utf8')).ownerId).toBe('alice')
  await runner.wait(id)
})

test('comparison export is stable and does not turn missing pricing into zero', () => {
  const run: Run = { id: 'one', ownerId: 'private-owner', harness: 'pi-agent', model: 'nvidia/lightning', gateway: 'merge-gateway',
    startedAt: '2026-09-10T12:00:00Z', agentFinishedAt: '2026-09-10T12:00:20Z', finishedAt: '2026-09-10T12:00:21Z',
    status: 'complete', chunks: [], grade: { passed: true, exitCode: 0, output: 'private grader text' } }
  const first = exportRuns([run])
  expect(exportRuns([run])).toEqual(first)
  expect(first.rows[0].agentSeconds).toBe(20)
  expect(first.rows[0].costUsd).toBeNull()
  expect(JSON.stringify(first)).not.toContain('private-owner')
  expect(JSON.stringify(first)).not.toContain('private grader text')
})

test('signup requires consent, persists normalized emails, deduplicates and throttles', async () => {
  const path = await directory()
  const signup = createSignupStore(path)
  const request = (body: object) => new Request('http://localhost/api/signups', { method: 'POST', body: JSON.stringify(body) })
  try {
    expect((await signup.handle(request({ email: 'demo@example.com' }), 'client')).status).toBe(400)
    expect((await signup.handle(request({ email: 'broken', consent: true }), 'client')).status).toBe(400)
    expect((await signup.handle(request({ email: ' DEMO@example.com ', consent: true }), 'client')).status).toBe(201)
  } finally { signup.close() }
  const restored = createSignupStore(path)
  try {
    for (let index = 0; index < 9; index++) expect((await restored.handle(request({ email: 'demo@example.com', consent: true }), 'client')).status).toBe(201)
    expect((await restored.handle(request({ email: 'demo@example.com', consent: true }), 'client')).status).toBe(429)
    const { Database } = await import('bun:sqlite')
    const db = new Database(join(path, 'signups.sqlite'), { readonly: true })
    try { expect(db.query('SELECT email FROM signups').all()).toEqual([{ email: 'demo@example.com' }]) } finally { db.close() }
  } finally { restored.close() }
})

test('hosted mode rejects missing persistence, invitations and a local Docker daemon', () => {
  const base = { HEVAL_HOSTED: '1', HEVAL_PUBLIC_ORIGIN: 'https://heval.example.com', HEVAL_DATA_DIR: '/data', HEVAL_ENABLE_RUNNER: '1', WORKOS_CLIENT_ID: 'client-test', HEVAL_ALLOWED_USER_IDS: 'alice', DOCKER_HOST: 'ssh://worker@10.0.0.2' }
  expect(deploymentPolicy(base).allowedUsers?.has('alice')).toBe(true)
  for (const field of ['HEVAL_PUBLIC_ORIGIN', 'HEVAL_DATA_DIR', 'WORKOS_CLIENT_ID', 'HEVAL_ALLOWED_USER_IDS', 'DOCKER_HOST']) expect(() => deploymentPolicy({ ...base, [field]: '' })).toThrow()
  expect(() => deploymentPolicy({ ...base, DOCKER_HOST: 'unix:///var/run/docker.sock' })).toThrow()
})
