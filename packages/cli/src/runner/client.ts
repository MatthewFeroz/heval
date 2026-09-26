import { publicMergeCatalog } from '../merge'
import { executionTimeoutSeconds, type MachineKind } from '../../../../src/runners/protocol'
import { workerMachineKind } from './machine'
import { spawn, execFile } from 'node:child_process'
import { HARBOR_VERSION, supportedHarborVersion } from '../harbor-version'
import { promisify } from 'node:util'
import { existsSync, mkdirSync, writeFileSync, rmSync, openSync, closeSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { ConvexHttpClient } from 'convex/browser'
import { ConvexError } from 'convex/values'
import { api } from '../../../../convex/_generated/api'
import type { Id } from '../../../../convex/_generated/dataModel'
import { randomSecret, readJson, writeJson } from './files'
import { initializeProfiles, loadProfiles, snapshotProfile, requestedProfile } from './profiles'
import { processKey, supervisorAlive, type Outcome } from './supervisor'
import type { RunMonitoring } from '../../../../src/runners/monitoring'

type Connection = { url: string; credential: string; id?: string; name?: string; pendingCode?: string }
const exec = promisify(execFile)
export function cloudUrl(input: string, allowLocal = process.env.HEVAL_RUNNER_ALLOW_LOCAL_CONVEX === '1') {
  const url = new URL(input)
  const cloud = url.protocol === 'https:' && /^[a-z0-9-]+\.convex\.cloud$/.test(url.hostname) && !url.port
  const loopback = allowLocal && url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost') && !!url.port
  if ((!cloud && !loopback) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Use the HTTPS convex.cloud deployment URL displayed in Heval.')
  return url.origin
}
function client(url: string) {
  const timedFetch = ((input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15_000) })) as typeof fetch
  return new ConvexHttpClient(cloudUrl(url), { fetch: timedFetch })
}
export async function connectRunner(directory: string, url: string, code: string, bundledTask: string) {
  url = cloudUrl(url)
  if (!/^[a-f0-9]{64}$/.test(code)) throw new Error('Paste the complete pairing code from Heval.')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const path = join(directory, 'connection.json')
  const previous = existsSync(path) ? readJson<Connection>(path) : undefined
  if (previous?.id) throw new Error('This state directory is already paired. Use a separate --state directory for another machine; do not copy credentials between machines.')
  if (previous && (previous.url !== url || previous.pendingCode !== code)) throw new Error('A connection attempt is pending in this directory. Retry its code or use a new --state directory.')
  const connection = previous ?? { url, credential: randomSecret(), pendingCode: code }
  // Persist before the exchange so a lost response can be retried with the same credential.
  writeJson(path, connection)
  const result = await client(url).mutation(api.runners.connect, { code, credential: connection.credential })
  writeJson(path, { url, credential: connection.credential, ...result })
  initializeProfiles(directory, bundledTask)
  return result
}
export async function checkRunner(harbor: string) {
  if (process.platform !== 'linux') return { ready: false, health: 'Connected runners currently require Linux.' }
  try { const { stdout } = await exec(harbor, ['--version'], { timeout: 15_000 }); if (!supportedHarborVersion(stdout)) return { ready: false, health: `Install the supported Harbor version: ${HARBOR_VERSION}.` } }
  catch { return { ready: false, health: `Harbor is unavailable. Install Harbor ${HARBOR_VERSION} on this machine.` } }
  try { await exec('docker', ['info', '--format', '{{.ServerVersion}}'], { timeout: 15_000 }); await exec('docker', ['compose', 'version'], { timeout: 15_000 }) }
  catch { return { ready: false, health: 'Docker Engine or Docker Compose is unavailable to this account.' } }
  return { ready: true, health: 'Harbor and Docker ready' }
}
function acquireLocalLock(directory: string) {
  const path = join(directory, 'daemon.lock')
  try { mkdirSync(path, { mode: 0o700 }) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    let stale = false
    try { const lock = readJson<{ pid: number; key: string }>(join(path, 'owner.json')); stale = processKey(lock.pid) !== lock.key } catch { /* An incomplete lock needs operator attention, not a racing deletion. */ }
    if (!stale) throw new Error('Another daemon owns this state directory. Stop it before starting another.', { cause: error })
    rmSync(path, { recursive: true }); mkdirSync(path, { mode: 0o700 })
  }
  writeJson(join(path, 'owner.json'), { pid: process.pid, key: processKey(process.pid) })
  return () => rmSync(path, { recursive: true, force: true })
}
export async function runDaemon(options: { directory: string; harbor: string; supervisor: string; profileFile?: string; signal?: AbortSignal; pollMs?: number; onEvent?: (text: string) => void }) {
  if (process.platform !== 'linux') throw new Error('Connected runners currently require Linux.')
  const directory = resolve(options.directory), path = join(directory, 'connection.json')
  const connection = readJson<Connection>(path)
  if (!connection.id || connection.pendingCode) throw new Error('Complete runner connect before starting the daemon.')
  const release = acquireLocalLock(directory)
  const cloud = client(connection.url), credential = connection.credential, session = randomSecret()
  const event = options.onEvent ?? console.log
  let stopped = false
  const stop = () => { stopped = true }
  options.signal?.addEventListener('abort', stop)
  process.once('SIGINT', stop); process.once('SIGTERM', stop)
  let health = { ready: false, health: 'Checking Harbor and Docker' }, nextCheck = 0, machine: MachineKind | undefined
  let lastCatalog: string | undefined
  let lastError = '', activeDirectory: string | null = null
  event(`Connected machine: ${connection.name}. Closing the browser does not stop evaluations.`)
  try {
    while (!stopped && !options.signal?.aborted) {
      try {
        if (Date.now() >= nextCheck) { health = await checkRunner(options.harbor); machine = await workerMachineKind(directory); nextCheck = Date.now() + 60_000 }
        const registry = options.profileFile ?? join(directory, 'profiles.json')
        let profiles: ReturnType<typeof loadProfiles> = []
        let readiness = health
        try { profiles = loadProfiles(registry, directory) } catch { readiness = { ready: false, health: 'An approved profile or provider connection is invalid. Check profiles.json and provider status on this machine.' } }
        const runsRoot = join(directory, 'runs')
        if (existsSync(runsRoot) && readdirSync(runsRoot).some(id => existsSync(join(runsRoot, id, 'cleanup-required.json')))) readiness = { ready: false, health: 'A previous execution needs local cleanup. See the runner documentation.' }
        const pendingPath = join(directory, 'pending-claim.json')
        if (!existsSync(pendingPath)) writeJson(pendingPath, { claimId: randomSecret() })
        const { claimId } = readJson<{ claimId: string }>(pendingPath)
        const modelCatalog = publicMergeCatalog(directory), catalogSignature = JSON.stringify(modelCatalog)
        const active = await cloud.mutation(api.runners.poll, { ...(catalogSignature !== lastCatalog ? { modelCatalog } : {}), credential, session, claimId, profiles: profiles.map(p => p.public), ...readiness, ...(machine ? { machine } : {}) })
        lastCatalog = catalogSignature
        if (lastError) { event('Cloud connection restored. Reconciling saved work.'); lastError = '' }
        if (!active) { rmSync(pendingPath, { force: true }); activeDirectory = null }
        else {
          const runDir = join(runsRoot, active.id)
          activeDirectory = runDir
          const executionPath = join(runDir, 'execution.json')
          const args = { credential, session, id: active.id as Id<'runnerRuns'>, claimId: active.claimId }
          if (!existsSync(executionPath)) {
            if (active.claimId !== claimId) {
              // Missing local state is not permission to execute the already-claimed work again.
              await cloud.mutation(api.runners.finish, { ...args, status: 'interrupted', message: 'This machine lost its local execution state. Inspect the original machine; the evaluation was not automatically restarted.' })
              mkdirSync(runDir, { recursive: true, mode: 0o700 }); writeJson(join(runDir, 'cleanup-required.json'), true)
              continue
            }
            const profile = profiles.find(p => p.public.id === active.profile.id && p.public.digest === active.profile.digest)
            if (!profile) { await cloud.mutation(api.runners.finish, { ...args, status: 'failed', message: 'The approved local profile changed before execution.' }); continue }
            mkdirSync(runDir, { recursive: true, mode: 0o700 })
            if (active.cancel) writeJson(join(runDir, 'outcome.json'), { status: 'cancelled' })
            else {
              try { snapshotProfile(requestedProfile(profile, active.requestedAttempts, active.runSettings), runDir) }
              catch { await cloud.mutation(api.runners.finish, { ...args, status: 'failed', message: 'Task files changed or could not be copied. Review the machine profile before starting again.' }); continue }
            }
            writeJson(executionPath, { claimId: active.claimId, harbor: options.harbor, timeoutSeconds: executionTimeoutSeconds(profile.public, active.requestedAttempts, active.runSettings), envFile: profile.envFile, mergeConnection: profile.mergeConnection })
          }
          if (readJson<{ claimId: string }>(executionPath).claimId !== active.claimId) throw new Error('Local execution identity differs from the cloud claim. Inspect this state directory.')
          rmSync(pendingPath, { force: true })
          if (active.cancel) writeFileSync(join(runDir, 'cancel'), '', { mode: 0o600 })
          const outcomePath = join(runDir, 'outcome.json')
          // The detached supervisor samples even while the cloud is unreachable.
          // Upload the newest durable snapshot before finishing; errors must not block cancellation or reports.
          try {
            const snapshot = readJson<RunMonitoring>(join(runDir, 'monitoring.json'))
            await cloud.mutation(api.runners.monitor, { ...args, snapshot })
          } catch { /* Older backends/workers and transient telemetry failures are compatible. */ }
          if (existsSync(outcomePath)) {
            const outcome = readJson<Outcome>(outcomePath)
            const saved = await cloud.mutation(api.runners.finish, { ...args, ...outcome })
            writeJson(join(runDir, 'acknowledged.json'), saved)
            event(`Evaluation ${active.id}: ${outcome.status}${saved.report ? `; report ${saved.report}` : ''}.`)
          } else if (!existsSync(join(runDir, 'started'))) {
            const log = openSync(join(runDir, 'supervisor.log'), 'a', 0o600)
            const child = spawn(process.execPath, [options.supervisor, runDir], { detached: true, stdio: ['ignore', log, log] })
            child.on('error', () => writeJson(outcomePath, { status: 'failed', message: 'The local execution supervisor could not start.' }))
            child.unref(); closeSync(log)
            event(`Evaluation ${active.id}: starting Harbor.`)
            // A detached supervisor owns execution; a daemon restart only reconnects to it.
            await cloud.mutation(api.runners.progress, { ...args, phase: 'Running Harbor' })
          } else if (!supervisorAlive(runDir) && Date.now() - statSync(join(runDir, 'started')).mtimeMs > 30_000) {
            writeJson(join(runDir, 'cleanup-required.json'), true)
            writeJson(outcomePath, { status: 'interrupted', message: 'The execution supervisor stopped unexpectedly. Inspect the machine and its containers; this run will not restart automatically.' })
          }
        }
      } catch (error) {
        const text = error instanceof ConvexError && typeof error.data === 'string' ? error.data : 'Connection or local state unavailable. Retrying; existing Harbor execution continues locally.'
        if (text !== lastError) { event(text); lastError = text }
        if (text.includes('revoked or invalid')) {
          if (activeDirectory && existsSync(activeDirectory)) writeFileSync(join(activeDirectory, 'cancel'), '', { mode: 0o600 })
          break
        }
      }
      if (!stopped) await new Promise<void>(done => setTimeout(done, options.pollMs ?? 5000))
    }
  } finally {
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); options.signal?.removeEventListener('abort', stop)
    release(); event('Daemon stopped. Any active Harbor supervisor continues; restart with the same state directory to reconnect.')
  }
}

export function runnerStatus(directory: string) {
  const connection = readJson<Connection>(join(directory, 'connection.json'))
  const runs = join(directory, 'runs')
  return { id: connection.id ?? null, name: connection.name ?? 'Pairing pending', url: connection.url, paired: !!connection.id, runs: existsSync(runs) ? readdirSync(runs).map(id => ({ id, running: supervisorAlive(join(runs, id)), outcome: existsSync(join(runs, id, 'outcome.json')) ? readJson<Outcome>(join(runs, id, 'outcome.json')).status : null })) : [] }
}
