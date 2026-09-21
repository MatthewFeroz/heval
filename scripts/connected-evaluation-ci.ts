/**
 * Required no-model end-to-end evaluation:
 * real Convex backend -> real CLI daemon -> detached supervisor -> Harbor/Docker
 * -> child report -> combined experiment report.
 */
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
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
const harbor = process.env.HEVAL_TEST_HARBOR ?? 'harbor'
let backend: ReturnType<typeof Bun.spawn> | undefined
let daemon: ReturnType<typeof Bun.spawn> | undefined
let ownerApi: ConvexHttpClient | undefined
let runner: Id<'runners'> | undefined
let experiment: Id<'experiments'> | undefined

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

  backend = Bun.spawn(['bunx', 'convex', 'dev', '--tail-logs', 'disable'], {
    cwd: app,
    env: { ...process.env, CONVEX_AGENT_MODE: 'anonymous', FORCE_COLOR: '0' },
    stdout: 'inherit', stderr: 'inherit',
  })
  const url = await localUrl()
  const token = await new SignJWT({ email: 'ci@example.invalid' }).setProtectedHeader({ alg: 'RS256', kid: 'ci', typ: 'JWT' }).setSubject('ci-owner').setIssuer(issuer).setAudience('heval-ci').setIssuedAt().setExpirationTime('1h').sign(privateKey)
  ownerApi = new ConvexHttpClient(url); ownerApi.setAuth(token)

  const code = randomSecret()
  await waitFor(async () => {
    try { await ownerApi!.mutation(api.runners.createPairing, { name: 'CI runner', code }); return true }
    catch { return null }
  }, 'deployed Convex runner functions')
  process.env.HEVAL_RUNNER_ALLOW_LOCAL_CONVEX = '1'
  const paired = await connectRunner(state, url, code, join(root, 'packages/cli/dist/runner-task'))
  runner = paired.id

  daemon = Bun.spawn(['node', join(root, 'packages/cli/dist/cli.js'), 'runner', 'start', '--state', state, '--harbor', harbor], {
    cwd: root,
    env: { ...process.env, HEVAL_RUNNER_ALLOW_LOCAL_CONVEX: '1' },
    stdout: 'inherit', stderr: 'inherit',
  })
  const machine = await waitFor(async () => {
    const current = (await ownerApi!.query(api.runners.list)).find(item => item.id === runner)
    return current?.ready && current.profiles.length ? current : null
  }, 'the live daemon to advertise a ready profile')
  const profile = machine.profiles.find(item => item.id === 'heval-setup')
  assert(profile, 'The daemon did not advertise its no-model setup profile.')

  experiment = await ownerApi.mutation(api.experiments.create, {
    runner,
    title: 'CI connected evaluation',
    requestId: randomSecret(),
    attempts: 1,
    profiles: [{ id: profile.id, digest: profile.digest }],
  })
  const finished = await waitFor(async () => {
    const detail = await ownerApi!.query(api.experiments.get, { id: experiment! })
    return detail.cells.every(cell => ['completed', 'failed', 'cancelled', 'interrupted'].includes(cell.status)) ? detail : null
  }, 'Harbor evaluation completion', 300_000)
  assert.equal(finished.cells.length, 1)
  if (finished.cells[0].status !== 'completed') await printRunDiagnostics(finished.cells[0].id)
  assert.equal(finished.cells[0].status, 'completed', finished.cells[0].message ?? finished.cells[0].phase)
  assert(finished.cells[0].report, 'The completed daemon run did not save its child report.')
  assert(finished.report, 'The terminal experiment did not create its combined report.')
  assert.notEqual(finished.report, finished.cells[0].report, 'The experiment must own a combined report separate from its diagnostic child report.')
  const report = await ownerApi.query(api.reports.get, { id: finished.report })
  assert(report, 'The combined report is not readable by its owner.')
  const data = JSON.parse(report.data) as { job: string; rows: { agent: string; passed: number }[] }
  assert.equal(data.job, 'CI connected evaluation')
  assert.deepEqual(data.rows.map(row => ({ agent: row.agent, passed: row.passed })), [{ agent: 'oracle', passed: 1 }])
  console.log(`PASS: Convex queue -> live daemon -> Harbor ${HARBOR_VERSION}/Docker -> combined report (${finished.report}).`)
} finally {
  if (ownerApi && experiment) await ownerApi.mutation(api.experiments.cancel, { id: experiment }).catch(() => {})
  if (state && existsSync(join(state, 'runs'))) {
    for (const id of new Bun.Glob('*').scanSync(join(state, 'runs'))) await writeFile(join(state, 'runs', id, 'cancel'), '').catch(() => {})
  }
  await stop(daemon)
  if (ownerApi && runner) await ownerApi.mutation(api.runners.revoke, { id: runner }).catch(() => {})
  await stop(backend)
  delete process.env.HEVAL_RUNNER_ALLOW_LOCAL_CONVEX
  await rm(temporary, { recursive: true, force: true })
}
