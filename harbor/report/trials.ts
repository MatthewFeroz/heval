/**
 * Harbor job directory -> normalized TrialRow[] (+ JobExport).
 *
 * Reads each trial's `config.json` (agent + model as configured) and
 * `result.json` (what actually ran: task, reward, timings, usage, the harness
 * version observed inside the sandbox). Does not depend on server/.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { SLOW_TRIAL_SECONDS, type JobExport, type TrialRow } from '../../src/charts/trial'

type Json = Record<string, unknown>

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown): string | null => (typeof v === 'string' && v.length ? v : null)

function seconds(span: unknown): number | null {
  if (!span || typeof span !== 'object') return null
  const { started_at, finished_at } = span as Json
  const t0 = Date.parse(String(started_at ?? '')), t1 = Date.parse(String(finished_at ?? ''))
  return Number.isFinite(t0) && Number.isFinite(t1) ? (t1 - t0) / 1000 : null
}

function findReward(node: unknown): number | null {
  if (!node || typeof node !== 'object') return null
  const obj = node as Json
  if (typeof obj.reward === 'number') return obj.reward
  for (const v of Object.values(obj)) {
    const found = findReward(v)
    if (found !== null) return found
  }
  return null
}

export function readTrial(dir: string): TrialRow | null {
  const cfgPath = join(dir, 'config.json'), resPath = join(dir, 'result.json')
  if (!existsSync(cfgPath) || !existsSync(resPath)) return null
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8')) as Json
  const res = JSON.parse(readFileSync(resPath, 'utf8')) as Json
  const agentCfg = (cfg.agent ?? {}) as Json
  const agent = str(agentCfg.name)
  if (!agent) return null

  const taskFull = str(res.task_name) ?? 'unknown'
  const model = str(agentCfg.model_name) ?? 'unknown'
  const modelShort = model.includes('/') ? model.split('/').slice(1).join('/') : model
  const usage = (res.agent_result ?? {}) as Json
  const info = (res.agent_info ?? {}) as Json
  const exc = res.exception_info as Json | null

  const reward = findReward(res.verifier_result) ?? 0
  const inputTokens = num(usage.n_input_tokens), outputTokens = num(usage.n_output_tokens)
  const agentSeconds = seconds(res.agent_execution)
  const error = exc ? (str(exc.exception_type) ?? 'error') : null
  // Harbor raises AgentTimeoutError when the agent step hits the task's cap.
  // Matched on substring so a renamed or subclassed variant still counts.
  const timedOut = error !== null && /timeout/i.test(error)

  return {
    trial: str(res.trial_name) ?? basename(dir),
    task: taskFull.includes('/') ? taskFull.split('/').slice(1).join('/') : taskFull,
    taskFull,
    taskChecksum: str(res.task_checksum),
    agent,
    agentVersion: str(info.version),
    model,
    modelShort,
    provider: model.includes('/') ? model.split('/')[0] : null,
    stack: `${agent} / ${modelShort}`,
    reward,
    passed: reward >= 1 ? 1 : 0,
    agentSeconds,
    totalSeconds: seconds(res),
    // A timeout is over the line whether or not the span was recorded.
    overSlow: timedOut || (agentSeconds !== null && agentSeconds > SLOW_TRIAL_SECONDS) ? 1 : 0,
    timedOut: timedOut ? 1 : 0,
    inputTokens,
    cacheTokens: num(usage.n_cache_tokens),
    outputTokens,
    totalTokens: inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null,
    costUsd: num(usage.cost_usd),
    startedAt: str(res.started_at),
    error,
  }
}

export function loadTrials(jobDir: string): TrialRow[] {
  const rows: TrialRow[] = []
  for (const entry of readdirSync(jobDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const row = readTrial(join(jobDir, entry.name))
    if (row) rows.push(row)
  }
  return rows.sort((a, b) => a.trial.localeCompare(b.trial))
}

export function exportJob(jobDir: string): JobExport {
  const rows = loadTrials(jobDir)
  const jobResult = join(jobDir, 'result.json')
  const jobId = existsSync(jobResult) ? str((JSON.parse(readFileSync(jobResult, 'utf8')) as Json).id) : null
  const agentVersions: Record<string, string[]> = {}
  for (const r of rows) {
    if (!r.agentVersion) continue
    const set = new Set(agentVersions[r.agent] ?? [])
    set.add(r.agentVersion)
    agentVersions[r.agent] = [...set].sort()
  }
  return {
    schemaVersion: 1,
    job: basename(resolve(jobDir)),
    jobId,
    generatedAt: new Date().toISOString(),
    source: resolve(jobDir),
    agentVersions,
    rows,
  }
}
