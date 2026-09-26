import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { exportJob } from '../../../../harbor/report/trials'
import { parseReport } from '../../../../src/reports/format'
import { readJson, writeJson } from './files'
import { mergeEnvironment } from '../merge'
import { sampleMonitoring } from './monitoring'
import { bundledAdapters } from './bundled-adapters'

const exec = promisify(execFile)
export type Execution = { claimId: string; harbor: string; timeoutSeconds: number; envFile?: string; mergeConnection?: string }
export type Outcome = { status: 'completed' | 'failed' | 'cancelled' | 'interrupted'; json?: string; message?: string }
export function processKey(pid: number): string | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8'), fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
    if (fields[0] === 'Z') return null
    return `${readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim()}:${fields[19]}`
  } catch { return null }
}
export function supervisorAlive(directory: string) {
  try { const state = readJson<{ pid: number; key: string }>(join(directory, 'supervisor.json')); return processKey(state.pid) === state.key } catch { return false }
}

/** Restrict cleanup to Compose projects named by this run's actual Harbor trial configs. */
export async function cleanupRun(directory: string) {
  const job = join(directory, 'jobs/evaluation')
  if (!existsSync(job)) return
  const prefixes = readdirSync(job, { withFileTypes: true }).filter(e => e.isDirectory()).flatMap(e => {
    try {
      const trial = readJson<{ trial_name: string }>(join(job, e.name, 'config.json')).trial_name
      if (trial !== e.name || !/^[a-zA-Z0-9_-]{1,140}$/.test(trial)) return []
      return [`${trial.toLowerCase()}__`]
    } catch { return [] }
  })
  if (!prefixes.length) return
  const args = { timeout: 20_000, maxBuffer: 1_000_000 }
  const containers = (await exec('docker', ['ps', '-a', '--filter', 'label=com.docker.compose.project', '--format', '{{.ID}} {{.Label "com.docker.compose.project"}}'], args)).stdout.trim().split('\n')
  for (const line of containers) {
    const [id, project] = line.split(' ')
    if (project && prefixes.some(p => project.startsWith(p))) await exec('docker', ['rm', '-f', id], args)
  }
  for (const kind of ['network', 'volume']) {
    const items = (await exec('docker', [kind, 'ls', '--filter', 'label=com.docker.compose.project', '--format', '{{.Name}}'], args)).stdout.trim().split('\n').filter(Boolean)
    for (const name of items) {
      const inspected = JSON.parse((await exec('docker', [kind, 'inspect', name], args)).stdout) as { Labels?: Record<string, string> }[]
      const project = inspected[0]?.Labels?.['com.docker.compose.project']
      if (project && prefixes.some(p => project.startsWith(p))) await exec('docker', [kind, 'rm', name], args)
    }
  }
}

/** Explicit operator recovery after an orphaned execution; never used to retry a claim. */
export async function recoverRun(directory: string) {
  if (!existsSync(join(directory, 'cleanup-required.json'))) throw new Error('This run has no pending cleanup marker.')
  if (supervisorAlive(directory)) throw new Error('The supervisor is still running. Cancel the evaluation in Heval and wait for it to stop.')
  const path = join(directory, 'harbor-process.json')
  if (existsSync(path)) {
    const { pid, key } = readJson<{ pid: number; key: string }>(path)
    if (key && processKey(pid) === key) {
      try { process.kill(-pid, 'SIGINT') } catch { /* already exited */ }
      const deadline = Date.now() + 20_000
      while (processKey(pid) === key && Date.now() < deadline) await new Promise(done => setTimeout(done, 250))
      if (processKey(pid) === key) { try { process.kill(-pid, 'SIGKILL') } catch { /* exited */ } }
    }
  }
  await cleanupRun(directory)
}

export async function supervise(directory: string) {
  const input = readJson<Execution>(join(directory, 'execution.json'))
  // This marker is never removed: the same claim can never start twice, even after a crash.
  try { mkdirSync(join(directory, 'started'), { mode: 0o700 }) } catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') return; throw e }
  writeJson(join(directory, 'supervisor.json'), { pid: process.pid, key: processKey(process.pid) })
  if (existsSync(join(directory, 'cancel'))) { writeJson(join(directory, 'outcome.json'), { status: 'cancelled', message: 'Cancelled before Harbor started.' }); return }
  let outcome: Outcome = { status: 'failed', message: 'Harbor did not produce a complete result. Inspect local logs on the machine.' }
  let child: ReturnType<typeof spawn> | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let killTimer: ReturnType<typeof setTimeout> | undefined
  let terminate: (() => void) | undefined
  let cancelled = false, timedOut = false, stopping = false
  const log = openSync(join(directory, 'harbor.log'), 'a', 0o600)
  sampleMonitoring(directory)
  const monitorTimer = setInterval(() => sampleMonitoring(directory), 5000)
  try {
    // Do not inherit the daemon's cloud credential or unrelated host credentials.
    const env = Object.fromEntries(['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_CONFIG', 'DOCKER_CERT_PATH', 'DOCKER_TLS_VERIFY', 'SSH_AUTH_SOCK'].flatMap(k => process.env[k] ? [[k, process.env[k]!]] : []))
    if (input.mergeConnection) {
      if (input.envFile) throw new Error('Merge runs must not override the saved connection with envFile.')
      const config = readJson<{ agents: { name: string }[] }>(join(directory, 'harbor.json'))
      Object.assign(env, mergeEnvironment(input.mergeConnection, config.agents[0].name))
    }
    const args = ['run', '--config', join(directory, 'harbor.json')]
    if (input.envFile) args.push('--env-file', input.envFile)
    child = spawn(input.harbor, args, { cwd: directory, env: { ...env, PYTHONPATH: bundledAdapters(), HARBOR_TELEMETRY: '0' }, detached: true, stdio: ['ignore', log, log] })
    const pid = child.pid
    if (pid) writeJson(join(directory, 'harbor-process.json'), { pid, key: processKey(pid) })
    const stop = () => {
      if (stopping || !pid) return
      stopping = true
      try { process.kill(-pid, 'SIGINT') } catch { /* already exited */ }
      killTimer = setTimeout(() => { try { process.kill(-pid, 'SIGKILL') } catch { /* exited */ } }, 20_000)
    }
    terminate = () => { cancelled = true; stop() }
    process.once('SIGTERM', terminate)
    process.once('SIGINT', terminate)
    const deadline = Date.now() + input.timeoutSeconds * 1000
    timer = setInterval(() => {
      if (existsSync(join(directory, 'cancel'))) { cancelled = true; stop() }
      else if (Date.now() >= deadline) { timedOut = true; stop() }
    }, 500)
    const code = await new Promise<number | null>((resolve, reject) => { child!.once('error', reject); child!.once('close', resolve) })
    if (killTimer) clearTimeout(killTimer)
    if (cancelled) outcome = { status: 'cancelled', message: 'Stopped on the connected machine.' }
    else if (timedOut) outcome = { status: 'failed', message: 'The approved evaluation time limit was reached. Inspect local logs.' }
    else {
      try {
        const raw = exportJob(join(directory, 'jobs/evaluation'), null)
        const expected = readJson<{ n_attempts: number; tasks: unknown[] }>(join(directory, 'harbor.json'))
        const failed = code !== 0 || raw.rows.some(r => r.error) || raw.rows.length !== expected.tasks.length * expected.n_attempts
        const json = JSON.stringify(parseReport(JSON.stringify(raw)))
        outcome = { status: failed ? 'failed' : 'completed', json, ...(failed ? { message: 'Harbor reported an execution error or incomplete trials. Available results were saved; inspect raw logs locally.' } : {}) }
      } catch { /* Preserve generic failure; never upload raw logs, paths or keys. */ }
    }
  } catch { outcome = { status: 'failed', message: 'Harbor could not start. Check the machine’s local logs and approved profile.' } }
  finally {
    if (terminate) { process.removeListener('SIGTERM', terminate); process.removeListener('SIGINT', terminate) }
    if (timer) clearInterval(timer)
    if (monitorTimer) clearInterval(monitorTimer)
    sampleMonitoring(directory)
    if (killTimer) clearTimeout(killTimer)
    closeSync(log)
    try { await cleanupRun(directory) }
    catch { outcome = { status: 'interrupted', message: 'Container cleanup needs attention on this machine. Inspect Docker before starting more work.' }; writeJson(join(directory, 'cleanup-required.json'), true) }
    writeJson(join(directory, 'outcome.json'), outcome)
  }
}
