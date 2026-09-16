#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { doctor } from './doctor'
import { loadInput } from './input'
import { startViewer } from './viewer'

const dist = dirname(fileURLToPath(import.meta.url))
const manifest = JSON.parse(readFileSync(join(dist, '../package.json'), 'utf8')) as { version: string }
const HELP = `Heval ${manifest.version} — local Harbor results viewer

Usage:
  heval                         Show this guide
  heval doctor [--json] [--strict]
  heval open [job.json | harbor-job-directory] [--port 4173] [--no-browser]
  heval --version

Start with: heval open
This opens the bundled example. No account, model key, Bun, or Docker needed.
Open your results: heval open ./jobs/my-harbor-job
Or use Studio's Open export button for a project or bundle.

The viewer supports charts, trial inspection, SVG/PNG, and project bundles.
Run fresh evaluations with Harbor; guided execution and social/video rendering
are not included in this first release. Doctor checks prerequisites without
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
    options: { help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' }, json: { type: 'boolean' }, strict: { type: 'boolean' }, port: { type: 'string' }, 'no-browser': { type: 'boolean' } },
    allowPositionals: true,
  })
  if (values.version) { console.log(manifest.version); return }
  if (values.help || positionals[0] === 'help' || !positionals.length) { console.log(HELP); return }
  const [command, path, ...extra] = positionals
  if (command === 'doctor') {
    if (path || values.port || values['no-browser']) throw new Error('Usage: heval doctor [--json] [--strict]')
    const checks = await doctor()
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
