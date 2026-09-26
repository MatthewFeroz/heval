import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { readJson, writeJson } from './files'
import { MAX_MONITOR_EVENTS, MAX_MONITOR_TRIALS, type LiveTrial, type RunMonitoring } from '../../../../src/runners/monitoring'

type Result = { finished_at?: string; exception_info?: unknown; verifier_result?: { rewards?: Record<string, unknown> } }
/** Observe Harbor's own artifacts, never agent transcripts or environment-bearing configs. */
export function collectMonitoring(directory: string, now = Date.now()): RunMonitoring {
  const path = join(directory, 'monitoring.json')
  let previous: RunMonitoring = { sequence: 0, sampledAt: now, trials: [], events: [] }
  try { previous = readJson<RunMonitoring>(path) } catch { /* First sample. */ }
  const trials = new Map(previous.trials.map(t => [t.id, t]))
  const events = [...previous.events]
  const job = join(directory, 'jobs/evaluation')
  let entries: string[] = []
  try { entries = readdirSync(job) } catch { /* Harbor is still preparing. */ }
  for (const id of entries.sort().slice(0, MAX_MONITOR_TRIALS + 10)) {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,140}$/.test(id)) continue
    const dir = join(job, id)
    try {
      if (!lstatSync(dir).isDirectory()) continue
      const config = lstatSync(join(dir, 'config.json'))
      if (!config.isFile() || config.isSymbolicLink()) continue
      const old = trials.get(id)
      // Harbor retries an execution error in the same trial directory. Re-read it.
      if (old && (old.state === 'passed' || old.state === 'failed')) continue
      if (!old && trials.size >= MAX_MONITOR_TRIALS) continue
      const startedAt = old?.startedAt ?? Math.min(now, Math.max(0, Math.floor(config.mtimeMs)))
      const trial: LiveTrial = old?.state === 'running' ? { ...old } : { id, state: 'running', startedAt, updatedAt: now }
      try {
        const resultPath = join(dir, 'result.json'), stat = lstatSync(resultPath)
        if (stat.isFile() && !stat.isSymbolicLink() && stat.size <= 2_000_000) {
          const result = JSON.parse(readFileSync(resultPath, 'utf8')) as Result
          if (result.finished_at) {
            const reward = result.verifier_result?.rewards?.reward
            trial.state = result.exception_info ? 'error' : typeof reward === 'number' ? reward >= 1 ? 'passed' : 'failed' : 'error'
            trial.finishedAt = Math.max(startedAt, Math.min(now, Number.isFinite(Date.parse(result.finished_at)) ? Date.parse(result.finished_at) : now))
          }
        }
      } catch { /* A partially written result must not turn into a failure. */ }
      if (!old || old.state !== trial.state) {
        trial.updatedAt = now
        events.push({ sequence: (events.at(-1)?.sequence ?? 0) + 1, at: now, trial: id, state: trial.state })
      }
      trials.set(id, trial)
    } catch { /* Ignore disappearing, incomplete and non-regular artifacts. */ }
  }
  const snapshot: RunMonitoring = { sequence: previous.sequence + 1, sampledAt: now, trials: [...trials.values()], events: events.slice(-MAX_MONITOR_EVENTS) }
  writeJson(path, snapshot)
  return snapshot
}

/** Telemetry must never stop execution, cancellation, or final report delivery. */
export function sampleMonitoring(directory: string) {
  try { collectMonitoring(directory) } catch { /* Local disk issues remain diagnosable independently of execution. */ }
}
