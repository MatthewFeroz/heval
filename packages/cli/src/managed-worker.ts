/** Private, per-comparison VM entry point. Not a user-facing CLI command. */
import { spawn } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connectMerge } from './merge'
import { loadProfiles, setupMergeProfiles } from './runner/profiles'
import { runDaemon } from './runner/client'
import { processKey } from './runner/supervisor'
import { readJson, writeJson } from './runner/files'
import { collectManagedEvidence } from './runner/evidence'

const root = dirname(fileURLToPath(import.meta.url)), directory = '/home/heval/managed'
switch (process.argv[2]) {
  case 'evidence': {
    const connection = readJson<{ key: string }>(join(directory, 'merge.json'))
    writeJson(join(directory, 'evidence.json'), collectManagedEvidence(directory, connection.key))
    break
  }
  case 'prepare': {
    if (process.platform !== 'linux') throw new Error('Managed workers require Linux.')
    const inputPath = join(directory, 'input.json')
    const input = JSON.parse(readFileSync(inputPath, 'utf8')) as { key: string; models: string[]; harnesses: string[] }
    try {
      await connectMerge(directory, input.key)
      for (const model of input.models) setupMergeProfiles(directory, join(root, 'runner-task'), model, input.harnesses, { id: 'tblite-smoke', source: '/opt/heval/benchmark' })
      writeJson(join(directory, 'public-profiles.json'), loadProfiles(join(directory, 'profiles.json')).map(p => p.public))
    } finally { rmSync(inputPath, { force: true }) }
    break
  }
  case 'start': {
    const marker = join(directory, 'managed-started')
    // This VM can only start its daemon once. A lost acknowledgment reconnects
    // to the same process; a dead process fails the job instead of rerunning it.
    if (existsSync(marker)) {
      const prior = readJson<{ pid: number; key: string }>(marker)
      if (processKey(prior.pid) !== prior.key) throw new Error('The original managed daemon stopped.')
      break
    }
    const lock = join(directory, 'managed-launch.lock')
    mkdirSync(lock, { mode: 0o700 })
    const log = openSync(join(directory, 'daemon.log'), 'a', 0o600)
    const child = spawn(process.execPath, [join(root, 'managed-worker.js'), 'run'], { detached: true, stdio: ['ignore', log, log] })
    try {
      await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) })
      const key = child.pid && processKey(child.pid)
      if (!child.pid || !key) throw new Error('Managed daemon identity unavailable.')
      writeFileSync(marker, JSON.stringify({ pid: child.pid, key }), { mode: 0o600 })
      child.unref()
    } finally { closeSync(log) }
    break
  }
  case 'run': await runDaemon({ directory, harbor: 'harbor', supervisor: join(root, 'runner-supervisor.js') }); break
  default: throw new Error('Choose an internal managed-worker operation.')
}
