/** Regenerate with: bun scripts/pin-tblite.ts /path/to/pinned/OpenThoughts-TBLite */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { hashDirectory, sha256 } from '../packages/cli/src/runner/files'

const source = resolve(process.argv[2] ?? '.')
const commit = '5c37b41f00ce04719a4453061076ae9f46b74b7d'
if (execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== commit || execFileSync('git', ['-C', source, 'status', '--porcelain'], { encoding: 'utf8' }).trim()) throw new Error(`Use a clean checkout of ${commit}.`)
const names = readdirSync(source).filter(name => existsSync(join(source, name, 'task.toml'))).sort()
if (names.length !== 100) throw new Error('Expected 100 TBLite tasks.')
const smoke = new Set(['jq-data-processing', 'pandas-etl', 'broken-python', 'log-summary', 'cryptographic-protocol-verifier'])
let timeoutSeconds = 0, smokeTimeoutSeconds = 0
const taskHashes = names.map(name => {
  const config = Bun.TOML.parse(readFileSync(join(source, name, 'task.toml'), 'utf8')) as { agent: { timeout_sec: number }; verifier: { timeout_sec: number }; environment?: { build_timeout_sec?: number } }
  // Serial execution: task agent + verifier + build budget, plus 30 minutes per
  // trial for harness installation, environment restart, cleanup and orchestration.
  const budget = Math.ceil(config.agent.timeout_sec + config.verifier.timeout_sec + (config.environment?.build_timeout_sec ?? 600) + 1800)
  if (!Number.isSafeInteger(budget) || budget <= 0) throw new Error(`Invalid timeouts for ${name}.`)
  timeoutSeconds += budget
  if (smoke.has(name)) smokeTimeoutSeconds += budget
  return [name, hashDirectory(join(source, name))]
})
writeFileSync(resolve(import.meta.dirname, '../src/runners/tblite.json'), JSON.stringify({ commit, timeoutSeconds, smokeTimeoutSeconds, taskSet: sha256(JSON.stringify(taskHashes.map(([, hash]) => hash))), taskHashes }, null, 2) + '\n')
