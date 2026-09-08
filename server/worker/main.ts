import { cpSync, mkdirSync } from 'node:fs'
import { prepareLaunch } from './launch'
import { isHarness } from '../types'

const harness = process.argv[2]
if (!isHarness(harness)) throw new Error('Unknown harness')
mkdirSync('/tmp/heval-home', { recursive: true })
cpSync('/opt/heval/fixture', '/workspace', { recursive: true })
const launch = prepareLaunch(harness, '/workspace')
const proc = Bun.spawn(launch.command, {
  cwd: '/workspace', env: launch.env,
  terminal: { cols: 96, rows: 24, data(_terminal, bytes) { process.stdout.write(bytes) } },
})
const code = await proc.exited
proc.terminal?.close()
process.exit(code)
