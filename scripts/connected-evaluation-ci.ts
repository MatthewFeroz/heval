/**
 * Required no-model end-to-end evaluation:
 * real Convex backend -> real CLI daemon -> detached supervisor -> Harbor/Docker
 * -> child report -> combined experiment report.
 */
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createServer, type ViteDevServer } from 'vite'
import { processKey, supervisorAlive, cleanupRun } from '../packages/cli/src/runner/supervisor'
import { RUNNER_ONLINE_MS } from '../src/runners/protocol'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { ConvexHttpClient } from 'convex/browser'
import { api } from '../convex/_generated/api'
import type { Id } from '../convex/_generated/dataModel'
import { connectRunner } from '../packages/cli/src/runner/client'
import { randomSecret } from '../packages/cli/src/runner/files'
import { HARBOR_VERSION } from '../packages/cli/src/harbor-version'

const root = resolve(import.meta.dirname, '..')
const temporary = await mkdtemp(join(tmpdir(), 'heval-connected-evaluation-'))
const app = join(temporary, 'app')
const state = join(temporary, 'runner')
const cli = join(temporary, 'cli/dist')
const harbor = process.env.HEVAL_TEST_HARBOR ?? 'harbor'
let backend: ReturnType<typeof Bun.spawn> | undefined
let daemon: ReturnType<typeof Bun.spawn> | undefined
let ownerApi: ConvexHttpClient | undefined
let runner: Id<'runners'> | undefined
let experiment: Id<'experiments'> | undefined
let web: ViteDevServer | undefined
let proxy: ReturnType<typeof Bun.serve> | undefined
let telemetryBlocked = false, droppedTelemetry = 0
const evidence: object[] = []
const isolatedEnv = Object.fromEntries(['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG', 'DOCKER_CERT_PATH', 'DOCKER_TLS_VERIFY', 'SSH_AUTH_SOCK'].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : []))
function unusedPort() { const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('') }); const port = server.port!; server.stop(true); return port }
function startDaemon() {
  return Bun.spawn(['node', join(cli, 'cli.js'), 'runner', 'start', '--state', state, '--harbor', harbor], {
    cwd: root, env: { ...isolatedEnv, HEVAL_RUNNER_ALLOW_LOCAL_CONVEX: '1' }, stdout: 'inherit', stderr: 'inherit',
  })
}
function projects(id: string) {
  const job = join(state, 'runs', id, 'jobs/evaluation')
  return readdirSync(job, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => JSON.parse(readFileSync(join(job, entry.name, 'config.json'), 'utf8')).trial_name.toLowerCase() + '__') as string[]
}
function assertClean(id: string) {
  const prefixes = projects(id)
  for (const args of [ ['ps', '-a', '--format', '{{.Label "com.docker.compose.project"}}'], ['network', 'ls', '--format', '{{.Name}}'], ['volume', 'ls', '--format', '{{.Name}}'] ]) {
    const names = execFileSync('docker', args, { encoding: 'utf8' }).split('\n')
    assert(!names.some(name => prefixes.some(prefix => name.startsWith(prefix))), 'Run-owned Docker resources remain after acknowledgment.')
  }
  assert(!existsSync(join(state, 'runs', id, 'cleanup-required.json')))
}

async function waitFor<T>(read: () => Promise<T | null | undefined | false>, label: string, timeout = 180_000): Promise<T> {
  const deadline = Date.now() + timeout
  let lastError: unknown
  while (Date.now() < deadline) {
    try { const value = await read(); if (value) return value }
    catch (error) { lastError = error }
    await Bun.sleep(500)
  }
  throw new Error(`Timed out waiting for ${label}.`, { cause: lastError })
}

async function localUrl() {
  const path = join(app, '.env.local')
  return waitFor(async () => {
    if (!existsSync(path)) return null
    const text = await readFile(path, 'utf8')
    return text.match(/^(?:VITE_)?CONVEX_URL=["']?(http:\/\/[^\s"']+)/m)?.[1]
  }, 'the local Convex deployment', 180_000)
}

async function stop(child: ReturnType<typeof Bun.spawn> | undefined) {
  if (!child || child.exitCode !== null) return
  child.kill('SIGTERM')
  await Promise.race([child.exited, Bun.sleep(15_000).then(() => { if (child.exitCode === null) child.kill('SIGKILL') })])
  await child.exited
}

async function printRunDiagnostics(id: string) {
  const directory = join(state, 'runs', id)
  for (const name of ['supervisor.log', 'harbor.log']) {
    const path = join(directory, name)
    if (!existsSync(path)) continue
    const contents = await readFile(path, 'utf8')
    console.error(`\n--- ${name} (last 12,000 characters) ---\n${contents.slice(-12_000)}`)
  }
}

try {
  await mkdir(join(temporary, 'cli'))
  await cp(join(root, 'packages/cli/package.json'), join(temporary, 'cli/package.json'))
  await cp(join(root, 'packages/cli/dist'), cli, { recursive: true })
  await mkdir(app, { recursive: true })
  await cp(join(root, 'convex'), join(app, 'convex'), { recursive: true })
  for (const test of new Bun.Glob('**/*.test.ts').scanSync(join(app, 'convex'))) await rm(join(app, 'convex', test))
  await cp(join(root, 'src'), join(app, 'src'), { recursive: true })
  await mkdir(join(app, 'server/hosted-exports'), { recursive: true })
  await cp(join(root, 'server/hosted-exports/render.ts'), join(app, 'server/hosted-exports/render.ts'))
  await symlink(join(root, 'node_modules'), join(app, 'node_modules'))
  await writeFile(join(app, 'package.json'), JSON.stringify({ type: 'module', dependencies: { convex: '^1.45.0', '@vercel/sandbox': '3.3.0', '@vercel/blob': '2.8.0' } }))

  const { publicKey, privateKey } = await generateKeyPair('RS256')
  const jwk = { ...await exportJWK(publicKey), kid: 'ci', alg: 'RS256', use: 'sig' }
  const issuer = 'https://heval-ci.invalid'
  await writeFile(join(app, 'convex/auth.config.ts'), `export default ${JSON.stringify({ providers: [{ type: 'customJwt', issuer, applicationID: 'heval-ci', algorithm: 'RS256', jwks: `data:text/plain;charset=utf-8;base64,${Buffer.from(JSON.stringify({ keys: [jwk] })).toString('base64')}` }] })}`)

  await mkdir(join(temporary, 'home'))
  const cloudPort = unusedPort(), sitePort = unusedPort()
  assert.notEqual(cloudPort, sitePort)
  backend = Bun.spawn(['node', join(root, 'node_modules/convex/bin/main.js'), 'dev', '--tail-logs', 'disable', '--local-cloud-port', String(cloudPort), '--local-site-port', String(sitePort)], {
    cwd: app,
    env: { ...isolatedEnv, HOME: join(temporary, 'home'), CONVEX_AGENT_MODE: 'anonymous', FORCE_COLOR: '0' },
    stdout: 'inherit', stderr: 'inherit',
  })
  const url = await localUrl()
  assert.equal(new URL(url).hostname, '127.0.0.1', 'The harness must use its disposable local backend.')
  const token = await new SignJWT({ email: 'ci@example.invalid' }).setProtectedHeader({ alg: 'RS256', kid: 'ci', typ: 'JWT' }).setSubject('ci-owner').setIssuer(issuer).setAudience('heval-ci').setIssuedAt().setExpirationTime('1h').sign(privateKey)
  ownerApi = new ConvexHttpClient(url); ownerApi.setAuth(token)

  const code = randomSecret()
  await waitFor(async () => {
    try { await ownerApi!.mutation(api.runners.createPairing, { name: 'CI runner', code }); return true }
    catch { return null }
  }, 'deployed Convex runner functions')
  process.env.HEVAL_RUNNER_ALLOW_LOCAL_CONVEX = '1'
  proxy = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    const body = request.method === 'POST' ? await request.text() : undefined
    if (telemetryBlocked && body && JSON.parse(body).path === 'runners:monitor') {
      droppedTelemetry++
      return new Response('Synthetic telemetry outage', { status: 503 })
    }
    return fetch(new URL(new URL(request.url).pathname, url), { method: request.method, headers: request.headers, body })
  } })
  if (process.env.HEVAL_TEST_BROWSER === '1') {
    process.env.VITE_CONVEX_URL = url
    web = await createServer({ root, cacheDir: join(temporary, 'browser-cache'), server: { host: process.env.HEVAL_TEST_BROWSER_HOST ?? '127.0.0.1', port: 0, proxy: { '/api': { target: url, ws: true } } }, plugins: [{
      name: 'connected-test-auth', enforce: 'pre',
      resolveId(source) { if (source.endsWith('AuthBoundary')) return '\0connected-test-auth' },
      transform(code, id) { if (id.endsWith('/src/reports/ReportProvider.tsx')) return code.replace('import.meta.env.VITE_CONVEX_URL', 'location.origin') },
      load(id) { if (id === '\0connected-test-auth') return `import React from 'react';import {AuthContext} from '/src/auth.ts';const auth={configured:true,isLoading:false,user:{id:'ci-owner',email:'ci@example.invalid'},signIn:async()=>{},signOut:async()=>{},getAccessToken:async()=>${JSON.stringify(token)}};export function AuthBoundary({children}){return React.createElement(AuthContext.Provider,{value:auth},children(auth))}` },
    }] })
    await web.listen()
  }
  const task = join(temporary, 'monitor-task')
  await cp(join(cli, 'runner-task'), task, { recursive: true })
  // Keep verification active across two samples so the real daemon must publish live progress.
  const taskConfig = join(task, 'task.toml')
  await writeFile(taskConfig, (await readFile(taskConfig, 'utf8')).replace('timeout_sec = 30.0', 'timeout_sec = 300.0'))
  const verifier = join(task, 'tests/test.sh')
  await writeFile(verifier, (await readFile(verifier, 'utf8')).replace('\n', '\nsleep 90\n'))
  const paired = await connectRunner(state, `http://127.0.0.1:${proxy.port}`, code, task)
  runner = paired.id
  // Two independent Oracle trials exercise actual parallel execution without model calls.
  await writeFile(join(state, 'setup.json'), JSON.stringify({ n_attempts: 1, agents: [{ name: 'oracle' }], tasks: [{ path: 'tasks/heval-setup' }, { path: 'tasks/heval-setup' }] }))

  daemon = startDaemon()
  const machine = await waitFor(async () => {
    const current = (await ownerApi!.query(api.runners.list)).find(item => item.id === runner)
    return current?.ready && current.profiles.length ? current : null
  }, 'the live daemon to advertise a ready profile')
  const profile = machine.profiles.find(item => item.id === 'heval-setup')
  assert(profile, 'The daemon did not advertise its no-model setup profile.')

  experiment = await ownerApi.mutation(api.experiments.create, {
    runner,
    title: 'CI connected evaluation',
    runSettings: { concurrency: 2, retries: 0, cpus: 1, memoryMb: 256, timeoutSeconds: 300 },
    requestId: randomSecret(),
    attempts: 1,
    profiles: [{ id: profile.id, digest: profile.digest }],
  })
  const detail = await waitFor(async () => {
    const detail = await ownerApi!.query(api.experiments.get, { id: experiment! })
    const live = await ownerApi!.query(api.runners.monitoring, { id: detail.cells[0].id, details: true })
    return live?.counts.running === 2 ? detail : null
  }, 'two active Oracle trials')
  const id = detail.cells[0].id, directory = join(state, 'runs', id)
  const execution = await readFile(join(directory, 'execution.json'), 'utf8')
  const supervisor = await readFile(join(directory, 'supervisor.json'), 'utf8')
  const child = JSON.parse(await readFile(join(directory, 'harbor-process.json'), 'utf8')) as { pid: number; key: string }
  if (web) console.log(`BROWSER: ${web.resolvedUrls!.local[0]}evaluations?experiment=${experiment}`)
  await stop(daemon)
  const previousHeartbeat = (await ownerApi.query(api.runners.list)).find(item => item.id === runner)!.lastSeen
  assert(supervisorAlive(directory), 'Daemon shutdown killed its detached supervisor.')
  assert.equal(processKey(child.pid), child.key)
  daemon = startDaemon()
  await waitFor(async () => {
    const machine = (await ownerApi!.query(api.runners.list)).find(item => item.id === runner)
    return machine?.lastSeen && machine.lastSeen > previousHeartbeat ? machine : null
  }, 'restarted daemon heartbeat', 60_000)
  assert.equal(await readFile(join(directory, 'execution.json'), 'utf8'), execution)
  assert.equal(await readFile(join(directory, 'supervisor.json'), 'utf8'), supervisor)
  assert.equal(processKey(child.pid), child.key)
  assert.equal((await ownerApi.query(api.runners.runs)).length, 1)
  evidence.push({ scenario: 'daemon restart during two active trials', experiment, run: id, expected: 'same claim, supervisor and Harbor process; one child run', observed: 'matched' })
  telemetryBlocked = true
  await waitFor(() => Promise.resolve(droppedTelemetry > 0), 'rejected telemetry request')
  const last = await ownerApi.query(api.runners.monitoring, { id, details: true })
  await Bun.sleep(25_000)
  const delayed = await ownerApi.query(api.runners.monitoring, { id, details: true })
  assert.equal(delayed?.sequence, last?.sequence)
  const connected = (await ownerApi.query(api.runners.list)).find(item => item.id === runner)!
  assert(Date.now() - connected.lastSeen < RUNNER_ONLINE_MS)
  assert(Date.now() - delayed!.receivedAt > 20_000)
  evidence.push({ scenario: 'interrupted telemetry', run: id, expected: 'heartbeat online, monitoring unchanged and delayed', observed: 'matched' })
  const finished = await waitFor(async () => {
    const detail = await ownerApi!.query(api.experiments.get, { id: experiment! })
    return detail.cells.every(cell => ['completed', 'failed', 'cancelled', 'interrupted'].includes(cell.status)) ? detail : null
  }, 'Harbor evaluation completion', 300_000)
  assert.equal(finished.cells.length, 1)
  const monitoring = await ownerApi.query(api.runners.monitoring, { id: finished.cells[0].id, details: true })
  assert.equal(monitoring?.sequence, last?.sequence)
  assert(droppedTelemetry > 0)
  evidence.push({ scenario: 'report delivery with telemetry rejected', run: id, childReport: finished.cells[0].report, combinedReport: finished.report, expected: 'completed once with two passes', observed: finished.cells[0].status })
  assertClean(id)
  telemetryBlocked = false
  if (finished.cells[0].status !== 'completed') await printRunDiagnostics(finished.cells[0].id)
  assert.equal(finished.cells[0].status, 'completed', finished.cells[0].message ?? finished.cells[0].phase)
  assert(finished.cells[0].report, 'The completed daemon run did not save its child report.')
  assert(finished.report, 'The terminal experiment did not create its combined report.')
  assert.notEqual(finished.report, finished.cells[0].report, 'The experiment must own a combined report separate from its diagnostic child report.')
  const report = await ownerApi.query(api.reports.get, { id: finished.report })
  assert(report, 'The combined report is not readable by its owner.')
  const data = JSON.parse(report.data) as { job: string; rows: { agent: string; passed: number }[] }
  assert.equal(data.job, 'CI connected evaluation')
  assert.deepEqual(data.rows.map(row => ({ agent: row.agent, passed: row.passed })), [{ agent: 'oracle', passed: 1 }, { agent: 'oracle', passed: 1 }])
  const job = JSON.parse(await readFile(join(state, 'runs', finished.cells[0].id, 'harbor.json'), 'utf8'))
  assert.equal(job.n_concurrent_trials, 2)
  assert.equal(job.environment.override_cpus, 1)
  assert.equal(job.environment.override_memory_mb, 256)
  assert.equal(job.retry.max_retries, 0)
  assert.equal(finished.cells[0].runSettings?.timeoutSeconds, 300)
  // A fast verified trial followed by a slow one allows cancellation of partial work.
  const slow = join(state, 'tasks/slow-setup')
  await cp(join(state, 'tasks/heval-setup'), slow, { recursive: true })
  await writeFile(join(state, 'tasks/heval-setup/tests/test.sh'), (await readFile(join(state, 'tasks/heval-setup/tests/test.sh'), 'utf8')).replace('sleep 90', 'sleep 1'))
  await writeFile(join(slow, 'tests/test.sh'), (await readFile(join(slow, 'tests/test.sh'), 'utf8')).replace('sleep 90', 'sleep 120'))
  await writeFile(join(state, 'setup.json'), JSON.stringify({ n_attempts: 1, agents: [{ name: 'oracle' }], tasks: [{ path: 'tasks/heval-setup' }, { path: 'tasks/slow-setup' }] }))
  const updated = await waitFor(async () => {
    const current = (await ownerApi!.query(api.runners.list)).find(item => item.id === runner)
    const next = current?.profiles.find(item => item.id === profile.id)
    return next?.digest !== profile.digest ? next : null
  }, 'updated synthetic task profile')
  experiment = await ownerApi.mutation(api.experiments.create, { runner, title: 'CI partial cancellation', requestId: randomSecret(), attempts: 1, profiles: [{ id: updated.id, digest: updated.digest }] })
  const active = await waitFor(async () => {
    const detail = await ownerApi!.query(api.experiments.get, { id: experiment! })
    const live = await ownerApi!.query(api.runners.monitoring, { id: detail.cells[0].id, details: true })
    return live?.counts.passed === 1 && live.counts.running === 1 ? detail.cells[0] : null
  }, 'one verified trial and one active trial')
  const queued = await ownerApi.mutation(api.runners.enqueue, { runner, profileId: updated.id, digest: updated.digest, requestId: randomSecret() })
  await ownerApi.mutation(api.runners.cancel, { id: queued })
  assert.equal((await ownerApi.query(api.runners.runs)).find(run => run.id === queued)?.status, 'cancelled')
  assert(!existsSync(join(state, 'runs', queued)), 'Queued cancellation launched local work.')
  await stop(daemon)
  await ownerApi.mutation(api.experiments.cancel, { id: experiment })
  assert.equal((await ownerApi.query(api.experiments.get, { id: experiment })).cells[0].status, 'cancelling')
  await Bun.sleep(46_000)
  const offline = await ownerApi.query(api.experiments.get, { id: experiment })
  assert.equal(offline.online, false)
  assert.equal(offline.cells[0].status, 'cancelling')
  assert(supervisorAlive(join(state, 'runs', active.id)))
  evidence.push({ scenario: 'offline active cancellation', experiment, run: active.id, expected: 'cancelling until worker returns; supervisor still active', observed: offline.cells[0].status })
  telemetryBlocked = true
  daemon = startDaemon()
  const cancelled = await waitFor(async () => {
    const detail = await ownerApi!.query(api.experiments.get, { id: experiment! })
    return detail.cells[0].status === 'cancelled' ? detail : null
  }, 'worker cancellation and cleanup acknowledgment')
  assertClean(active.id)
  const stoppedChild = JSON.parse(await readFile(join(state, 'runs', active.id, 'harbor-process.json'), 'utf8')) as { pid: number; key: string }
  assert.notEqual(processKey(stoppedChild.pid), stoppedChild.key)
  assert(cancelled.report)
  const partial = await ownerApi.query(api.reports.get, { id: cancelled.report })
  assert.deepEqual(JSON.parse(partial!.data).rows.map((row: { passed: number }) => row.passed), [1])
  await waitFor(() => Promise.resolve(existsSync(join(state, 'runs', active.id, 'acknowledged.json'))), 'durable cancellation acknowledgment')
  assert.equal((await ownerApi.query(api.runners.runs)).length, 3, 'Recovery created a duplicate child run.')
  assert.equal((await ownerApi.query(api.reports.list)).length, 4, 'Terminal delivery created duplicate reports.')
  assert(!existsSync(join(state, 'runs', queued)))
  evidence.push({ scenario: 'active cancellation with telemetry rejected', experiment, run: active.id, queuedRun: queued, childReport: cancelled.cells[0].report, combinedReport: cancelled.report, expected: 'cancelled after cleanup; one verified pass, unfinished trial excluded; queued work never launched', observed: 'matched' })
  console.log(JSON.stringify({ baseRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), modelCalls: 0, droppedTelemetry, evidence }, null, 2))
  console.log(`PASS: Convex queue -> live daemon -> Harbor ${HARBOR_VERSION}/Docker -> combined report (${finished.report}).`)
  if (web && process.env.HEVAL_TEST_BROWSER_ACK_FILE) {
    console.log(`BROWSER: ${web.resolvedUrls!.local[0]}evaluations?experiment=${experiment}`)
    await waitFor(() => Promise.resolve(existsSync(process.env.HEVAL_TEST_BROWSER_ACK_FILE!)), 'browser verification acknowledgment', 180_000)
  }
} finally {
  let cleaned = false
  try {
    if (ownerApi && experiment) await ownerApi.mutation(api.experiments.cancel, { id: experiment }).catch(() => {})
    if (existsSync(join(state, 'runs'))) {
      for (const id of readdirSync(join(state, 'runs'))) await writeFile(join(state, 'runs', id, 'cancel'), '').catch(() => {})
    }
    await stop(daemon)
    if (existsSync(join(state, 'runs'))) {
      for (const id of readdirSync(join(state, 'runs'))) {
        const directory = join(state, 'runs', id)
        await waitFor(() => Promise.resolve(!supervisorAlive(directory)), 'disposable supervisor shutdown', 90_000)
        await cleanupRun(directory)
      }
    }
    cleaned = true
  } finally {
    await web?.close()
    proxy?.stop(true)
    if (ownerApi && runner) await ownerApi.mutation(api.runners.revoke, { id: runner }).catch(() => {})
    await stop(backend)
    delete process.env.HEVAL_RUNNER_ALLOW_LOCAL_CONVEX
    if (cleaned) await rm(temporary, { recursive: true, force: true })
    else console.error(`Disposable worker state retained for run-specific cleanup: ${temporary}`)
  }
}
