import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connectRunner, runnerStatus, runDaemon, checkRunner } from './runner/client'
import { initializeProfiles, setupMergeProfiles } from './runner/profiles'
import { connectMerge, mergeStatus } from './merge'
import { isMachineKind } from '../../../src/runners/protocol'

const dist = dirname(fileURLToPath(import.meta.url))
const state = process.env.HEVAL_WORKER_STATE
if (!state?.startsWith('/var/lib/docker/volumes/') || !state.endsWith('/_data/runner')) throw new Error('Missing managed worker state.')
const directory: string = state
const task = join(dist, 'runner-task')

async function rpc() {
  let input = ''
  for await (const chunk of process.stdin) { input += chunk; if (input.length > 8192) throw new Error('Input too large.') }
  const body = JSON.parse(input)
  if (body.action === 'status') return { ...mergeStatus(directory), worker: { ...(existsSync(join(directory, 'connection.json')) ? runnerStatus(directory) : { paired: false }), ...await checkRunner('harbor') } }
  if (body.action === 'connect' && typeof body.key === 'string') return connectMerge(directory, body.key)
  if (body.action === 'profiles' && typeof body.model === 'string' && Array.isArray(body.harnesses) && body.harnesses.every((h: unknown) => typeof h === 'string')) return { profiles: setupMergeProfiles(directory, task, body.model, body.harnesses) }
  // The host detects its own kind; the container would only see Docker's VM.
  if (body.action === 'machine' && isMachineKind(body.kind)) { writeFileSync(join(directory, 'machine.json'), JSON.stringify({ kind: body.kind }), { mode: 0o600 }); return { kind: body.kind } }
  if (body.action === 'pair' && typeof body.url === 'string' && typeof body.code === 'string') return connectRunner(directory, body.url, body.code, task)
  throw new Error('Invalid worker request.')
}

if (process.argv[2] === 'rpc') {
  try { console.log(JSON.stringify(await rpc())) }
  catch { console.error('Worker request failed. Check the setup input and Docker connection.'); process.exitCode = 1 }
} else {
  initializeProfiles(directory, task)
  const stop = new AbortController()
  process.once('SIGTERM', () => stop.abort()); process.once('SIGINT', () => stop.abort())
  console.log('Heval worker ready for local setup. Waiting for account pairing.')
  while (!stop.signal.aborted) {
    let paired = false
    try { paired = !!JSON.parse(readFileSync(join(directory, 'connection.json'), 'utf8')).id } catch { /* Not paired yet. */ }
    if (paired) {
      await runDaemon({ directory, harbor: 'harbor', supervisor: join(dist, 'runner-supervisor.js'), signal: stop.signal })
      break // Revocation requires operator action; do not reconnect in a hot loop.
    }
    await new Promise<void>(done => { const timer = setTimeout(finish, 1000); function finish() { clearTimeout(timer); stop.signal.removeEventListener('abort', finish); done() } stop.signal.addEventListener('abort', finish, { once: true }) })
  }
}
