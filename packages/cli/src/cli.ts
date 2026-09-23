#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { readFileSync, existsSync, rmSync, readdirSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { homedir } from 'node:os'
import { createInterface } from 'node:readline/promises'
import { connectRunner, runDaemon, runnerStatus, checkRunner } from './runner/client'
import { recoverRun, supervise, type Outcome } from './runner/supervisor'
import { loadProfiles, setupMergeProfiles, snapshotProfile } from './runner/profiles'
import { randomSecret, readJson, writeJson } from './runner/files'
import { connectMerge, disconnectMerge, mergeStatus, readMergeKey } from './merge'
import { doctor } from './doctor'
import { HARBOR_VERSION } from './harbor-version'
import { loadInput } from './input'
import { startViewer } from './viewer'

const dist = dirname(fileURLToPath(import.meta.url))
const manifest = JSON.parse(readFileSync(join(dist, '../package.json'), 'utf8')) as { version: string }
const HELP = `Heval ${manifest.version} — local Harbor results viewer

Usage:
  heval                         Show this guide
  heval doctor [--json] [--strict]
  heval open [job.json | harbor-job-directory] [--port 4173] [--no-browser]
  heval provider connect merge [--key-stdin] [--state <directory>]
  heval provider status merge [--state <directory>]
  heval provider disconnect merge [--state <directory>]
  heval runner setup --model <merge-model-id> --harnesses codex,claude-code,opencode,pi
                    [--benchmark tblite-smoke --source <checkout>]
  heval runner test --profile <profile-id> [--state <directory>] [--harbor <executable>]
  heval runner connect --url <deployment.convex.cloud> [--state <directory>]
  heval runner start [--state <directory>] [--harbor <executable>] [--profiles <file>]
  heval runner status [--state <directory>]
  heval runner cleanup <run-id> [--state <directory>]
  heval --version

Start with: heval open
This opens the bundled example. No account, model key, Bun, or Docker needed.
Open your results: heval open ./jobs/my-harbor-job
Or use Studio's Open export button for a project or bundle.

The viewer supports charts, trial inspection, SVG/PNG, and project bundles.
Connect a Linux machine through the website's Machines page, then use runner
connect and runner start. Requires Harbor ${HARBOR_VERSION} and Docker on that machine.
Approved profiles and model credentials stay on the machine; results save online.
Merge setup saves one key for Heval runs only; standalone CLI settings are untouched.
Runner test executes a local profile without pairing and uses model credits.
Social/video rendering is not included. Doctor checks prerequisites without
installing software or making model calls. --strict fails on missing required
evaluation tools; --json emits machine-readable checks.
`

function openBrowser(url: string) {
  const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32.exe' : 'xdg-open'
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url]
  const child = spawn(command, args, { stdio: 'ignore', detached: true, windowsHide: true })
  child.on('error', () => console.error('Could not launch a browser. Open the URL above manually.'))
  child.on('exit', code => { if (code) console.error('Could not launch a browser. Open the URL above manually.') })
  child.unref()
}

async function main() {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('Heval requires Node.js 22 or newer.')
  const { values, positionals } = parseArgs({
    options: { help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' }, json: { type: 'boolean' }, strict: { type: 'boolean' }, port: { type: 'string' }, 'no-browser': { type: 'boolean' }, url: { type: 'string' }, state: { type: 'string' }, harbor: { type: 'string' }, profiles: { type: 'string' }, 'key-stdin': { type: 'boolean' }, model: { type: 'string' }, harnesses: { type: 'string' }, benchmark: { type: 'string' }, source: { type: 'string' }, profile: { type: 'string' } },
    allowPositionals: true,
  })
  if (values.version) { console.log(manifest.version); return }
  if (values.help || positionals[0] === 'help' || !positionals.length) { console.log(HELP); return }
  const [command, path, ...extra] = positionals
  if (values['key-stdin'] && !(command === 'provider' && path === 'connect')) throw new Error('--key-stdin applies only to provider connect.')
  if ((values.model || values.harnesses || values.benchmark || values.source) && !(command === 'runner' && path === 'setup')) throw new Error('--model, --harnesses, --benchmark and --source apply only to runner setup.')
  if (!values.benchmark !== !values.source) throw new Error('Use --benchmark and --source together.')
  if (values.profile && !(command === 'runner' && path === 'test')) throw new Error('--profile applies only to runner test.')
  if (command === 'provider') {
    if (extra.length !== 1 || extra[0] !== 'merge' || !['connect', 'status', 'disconnect'].includes(path) || values.url || values.harbor || values.profiles || values.port || values.strict || values['no-browser']) throw new Error('Use heval provider connect|status|disconnect merge [--state <directory>].')
    const directory = resolve(values.state ?? join(homedir(), '.heval/runner'))
    if (path === 'connect') {
      const status = await connectMerge(directory, await readMergeKey(!!values['key-stdin']))
      console.log(`Merge connected: ${status.models.length} tool-capable models. Key saved for Heval only.\nNext: heval provider status merge`)
    } else if (path === 'status') console.log(JSON.stringify(mergeStatus(directory), null, 2))
    else { disconnectMerge(directory); console.log('Saved Merge key removed. Future runs require reconnecting; already running evaluations are not revoked.') }
    return
  }
  if (command === 'runner') {
    if (process.platform !== 'linux') throw new Error('Run the connected runner on a Linux machine with Harbor and Docker.')
    if ((extra.length && path !== 'cleanup') || values.port || values.json || values.strict || values['no-browser']) throw new Error('Run heval --help for runner commands.')
    const directory = resolve(values.state ?? join(homedir(), '.heval/runner'))
    if (path === 'setup') {
      if (!values.model || !values.harnesses || values.profiles || values.url) throw new Error('Use runner setup --model <exact-model-id> --harnesses codex,claude-code,opencode,pi.')
      const profiles = setupMergeProfiles(directory, join(dist, 'runner-task'), values.model, values.harnesses.split(',').map(h => h.trim()), values.benchmark ? { id: values.benchmark, source: values.source! } : undefined)
      console.log(`Created profiles: ${profiles.join(', ')}. No model calls made.\nTest each with: heval runner test --profile <id> (uses model credits).`)
    } else if (path === 'test') {
      if (!values.profile || values.url) throw new Error('Use runner test --profile <profile-id>. This executes the profile using model credits.')
      const profile = loadProfiles(values.profiles ? resolve(values.profiles) : join(directory, 'profiles.json'), directory).find(p => p.public.id === values.profile)
      if (!profile) throw new Error('Profile not found. Run runner setup first.')
      const health = await checkRunner(values.harbor ?? 'harbor')
      if (!health.ready) throw new Error(health.health)
      const localRuns = join(directory, 'local-runs')
      if (existsSync(localRuns) && readdirSync(localRuns).some(id => existsSync(join(localRuns, id, 'cleanup-required.json')))) throw new Error('A previous local run needs cleanup. Use runner cleanup <run-id> with the same --state.')
      const runDirectory = join(directory, 'local-runs', randomSecret())
      snapshotProfile(profile, runDirectory)
      writeJson(join(runDirectory, 'execution.json'), { claimId: randomSecret(), harbor: values.harbor ?? 'harbor', timeoutSeconds: profile.public.timeoutSeconds, envFile: profile.envFile, mergeConnection: profile.mergeConnection })
      console.log(`Running ${profile.public.agent} / ${profile.public.model}. Model-backed profiles use credits.\nLogs: ${runDirectory}`)
      await supervise(runDirectory)
      const outcome = readJson<Outcome>(join(runDirectory, 'outcome.json'))
      console.log(`Execution: ${outcome.status}. ${outcome.message ?? ''}`)
      if (outcome.status !== 'completed') process.exitCode = 1
      else {
        const job = JSON.parse(outcome.json!) as { rows: { passed: number | null }[] }
        const passed = job.rows.filter(row => row.passed === 1).length
        console.log(`Grading: ${passed}/${job.rows.length} passed.\nOpen results: heval open ${JSON.stringify(join(runDirectory, 'jobs/evaluation'))}`)
        if (passed !== job.rows.length) process.exitCode = 1
      }
    } else if (path === 'connect') {
      if (!values.url) throw new Error('Use --url with the HTTPS Convex deployment URL shown on the Machines page.')
      const input = createInterface({ input: process.stdin, output: process.stdout })
      let code: string
      try { code = (await input.question('Paste the one-time pairing code from Heval: ')).trim() } finally { input.close() }
      const result = await connectRunner(directory, values.url, code, join(dist, 'runner-task'))
      console.log(`Paired ${result.name}. Start the connection with:\nheval runner start --state ${JSON.stringify(directory)}\nThe setup profile uses no model credits. Keep this state directory on this machine.`)
    } else if (path === 'start') {
      await runDaemon({ directory, harbor: values.harbor ?? 'harbor', supervisor: join(dist, 'runner-supervisor.js'), profileFile: values.profiles ? resolve(values.profiles) : undefined })
    } else if (path === 'status') console.log(JSON.stringify(runnerStatus(directory), null, 2))
    else if (path === 'cleanup') {
      if (extra.length !== 1 || !/^[a-z0-9]{16,64}$/.test(extra[0])) throw new Error('Use heval runner cleanup <run-id> --state <directory>.')
      const cloudRun = join(directory, 'runs', extra[0])
      const localRun = join(directory, 'local-runs', extra[0])
      if (existsSync(cloudRun) && existsSync(localRun)) throw new Error('Ambiguous run ID; inspect the state directory.')
      const runDirectory = existsSync(localRun) ? localRun : cloudRun
      await recoverRun(runDirectory)
      rmSync(join(runDirectory, 'cleanup-required.json'))
      console.log('This run’s remaining containers were cleaned up. The evaluation will not be retried automatically.')
    } else throw new Error('Use heval runner connect, start, status, or cleanup.')
    return
  }
  if (values.url || (values.state && command !== 'doctor') || values.harbor || values.profiles) throw new Error('--url, --harbor and --profiles apply to runner commands; --state also applies to doctor.')
  if (command === 'doctor') {
    if (path || values.port || values['no-browser']) throw new Error('Usage: heval doctor [--json] [--strict]')
    const checks = await doctor()
    const saved = mergeStatus(resolve(values.state ?? join(homedir(), '.heval/runner')))
    checks.push({ name: 'Saved Merge connection', ok: saved.connected, required: false, detail: saved.connected ? `${saved.models.length} catalog models; key saved for Heval runs (live harness access not checked)` : 'Not connected', fix: 'Run heval provider connect merge with the same --state directory.' })
    const ready = checks.filter(check => check.required).every(check => check.ok)
    if (values.json) console.log(JSON.stringify({ viewerReady: true, evaluationToolsReady: ready, checks }, null, 2))
    else {
      console.log('Results viewer: ready (Node.js only).\nEvaluation setup:')
      for (const check of checks) {
        console.log(`  ${check.ok ? 'OK' : check.required ? 'MISSING' : 'OPTIONAL'}  ${check.name}: ${check.detail}`)
        if (!check.ok && check.fix) console.log(`    ${check.fix}`)
      }
      console.log('\nCredential presence does not verify provider access or the job configuration.\nExplore an example now: heval open')
    }
    if (values.strict && !ready) process.exitCode = 1
    return
  }
  if (command !== 'open') throw new Error(`Unknown command: ${command}. Run heval --help.`)
  if (extra.length || values.json || values.strict) throw new Error('Usage: heval open [path] [--port 4173] [--no-browser]')
  const port = values.port === undefined ? 0 : Number(values.port)
  if (!Number.isInteger(port) || port < 0 || port > 65535 || values.port === '') throw new Error('--port must be an integer from 0 to 65535 (0 chooses a free port).')
  const web = join(dist, 'web')
  if (!existsSync(join(web, 'studio.html'))) throw new Error('The packaged UI is missing. Reinstall Heval or run bun run cli:build from the repository.')
  const input = path ? resolve(path) : join(dist, 'example.json')
  const job = loadInput(input)
  const { server, url } = await startViewer(web, job, port)
  console.log(`${path ? 'Loaded' : 'Bundled example:'} ${job.job} (${job.rows.length} trials)\n${url}\n\nResults stay on this machine. This is a snapshot; reopen after more trials finish.\nPress Ctrl+C to stop.`)
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {
    server.closeAllConnections()
    server.close(() => { process.exitCode = 0 })
  })
  if (!values['no-browser']) openBrowser(url)
}

main().catch((error: Error & { code?: string }) => {
  console.error(`heval: ${error.code === 'EADDRINUSE' ? 'That port is already in use. Omit --port to choose a free one.' : error.message}`)
  process.exitCode = 1
})
