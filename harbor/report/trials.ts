/**
 * Harbor job directory -> normalized TrialRow[] (+ JobExport).
 *
 * Reads each trial's `config.json` (agent + model as configured) and
 * `result.json` (what actually ran: task, reward, timings, usage, the harness
 * version observed inside the sandbox). Does not depend on server/.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { SLOW_TRIAL_SECONDS, type JobExport, type TrialRow } from '../../src/charts/trial'
import { loadCatalog, priceTokens, routeFor, type Catalog } from '../gateway/catalog'

type Json = Record<string, unknown>

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown): string | null => (typeof v === 'string' && v.length ? v : null)

function canonicalModel(model: string, agent: Json, env: Json): string {
  // These Harbor adapters prepend their transport provider to the full Merge
  // model slug. The exact gateway URL proves which prefix we can remove from
  // old configs too; custom endpoints and agents keep their configured IDs.
  if (!agent.import_path && ['pi', 'opencode', 'grok-build'].includes(String(agent.name)) && env.OPENAI_BASE_URL === 'https://api-gateway.merge.dev/v1/openai' && /^openai\/[^/]+\/.+/.test(model)) return model.slice('openai/'.length)
  return model
}

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

/** `requireComplete` rejects missing results; `verifiedOnly` skips unfinished terminal artifacts. */
export type ReadOptions = { requireComplete?: boolean; verifiedOnly?: boolean }

export function readTrial(dir: string, catalog?: Catalog | null, opts: ReadOptions = {}): TrialRow | null {
  const cfgPath = join(dir, 'config.json'), resPath = join(dir, 'result.json')
  if (!existsSync(resPath)) {
    if (opts.requireComplete && existsSync(cfgPath)) throw new Error(`Incomplete trial: ${dir} has no result.json`)
    return null
  }
  const cfg = existsSync(cfgPath) ? JSON.parse(readFileSync(cfgPath, 'utf8')) as Json : {}
  let res: Json
  try { res = JSON.parse(readFileSync(resPath, 'utf8')) as Json }
  catch (error) { if (opts.verifiedOnly) return null; throw error }
  // Connected terminal exports contain only finished verifier outcomes. A stopped
  // trial's absent reward (or partially written result) is not a verifier failure.
  if (opts.verifiedOnly && (!res || typeof res !== 'object' || !str(res.finished_at) || !Number.isFinite(Date.parse(String(res.finished_at))) || res.exception_info || num(findReward(res.verifier_result)) === null)) return null
  // Harbor may omit default values (including the Oracle agent) from config.json.
  // result.json retains the fully resolved configuration; old exports keep the
  // explicit per-trial config as the overriding source.
  const resolvedCfg = (res.config ?? {}) as Json
  const agentCfg = { ...((resolvedCfg.agent ?? {}) as Json), ...((cfg.agent ?? {}) as Json) }
  const info = (res.agent_info ?? {}) as Json
  const agent = str(info.name) ?? str(agentCfg.name) ?? str(agentCfg.import_path) ?? 'unknown'
  const kwargs = (agentCfg.kwargs ?? {}) as Json
  // Harbor records the agent's configured env per trial, so the vendor the job
  // pinned through the proxy survives as provenance rather than being asserted
  // by whoever writes up the results.
  const agentEnv = (agentCfg.env ?? {}) as Json

  const taskFull = str(res.task_name) ?? 'unknown'
  const model = canonicalModel(str(agentCfg.model_name) ?? str((info.model_info as Json | undefined)?.name) ?? 'unknown', agentCfg, agentEnv)
  const modelShort = model.includes('/') ? model.split('/').slice(1).join('/') : model
  const usage = (res.agent_result ?? {}) as Json
  const exc = res.exception_info as Json | null

  const reward = findReward(res.verifier_result) ?? 0
  const inputTokens = num(usage.n_input_tokens), outputTokens = num(usage.n_output_tokens)
  const agentSeconds = seconds(res.agent_execution)
  const error = exc ? (str(exc.exception_type) ?? 'error') : null
  // Harbor raises AgentTimeoutError when the agent step hits the task's cap.
  // Setup/verifier timeouts are not agent execution timeouts. Unknown phases
  // remain visible in error so downstream presets can reject ambiguous data.
  const timedOut = error === 'AgentTimeoutError'

  // Prefer the harness's own figure. Fall back to pricing the tokens against
  // the catalog rate for the pinned route, which is the only way Codex trials
  // get a cost at all - see priceTokens() for why.
  const vendor = str(agentEnv.HEVAL_VENDOR)
  const cacheTokens = num(usage.n_cache_tokens)
  const reported = num(usage.cost_usd)
  let cost = reported
  let costSource: TrialRow['costSource'] = reported === null ? null : 'reported'
  if (cost === null && catalog) {
    const route = routeFor(model, vendor, catalog)
    const derived = route ? priceTokens({ inputTokens, cacheTokens, outputTokens }, route) : null
    if (derived !== null) { cost = derived; costSource = 'derived' }
  }

  return {
    trial: str(res.trial_name) ?? basename(dir),
    trialId: str(res.id),
    agentImportPath: str(agentCfg.import_path),
    thinking: str(kwargs.thinking),
    reasoningEffort: str(kwargs.reasoning_effort),
    task: taskFull.includes('/') ? taskFull.split('/').slice(1).join('/') : taskFull,
    taskFull,
    taskChecksum: str(res.task_checksum),
    agent,
    agentVersion: str(info.version),
    model,
    modelShort,
    provider: model.includes('/') ? model.split('/')[0] : null,
    vendor,
    stack: `${agent} / ${modelShort}`,
    reward,
    passed: reward >= 1 ? 1 : 0,
    agentSeconds,
    totalSeconds: seconds(res),
    // A timeout is over the line whether or not the span was recorded.
    overSlow: timedOut || (agentSeconds !== null && agentSeconds > SLOW_TRIAL_SECONDS) ? 1 : 0,
    timedOut: timedOut ? 1 : 0,
    inputTokens,
    cacheTokens,
    outputTokens,
    totalTokens: inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null,
    costUsd: cost,
    costSource,
    startedAt: str(res.started_at),
    error,
  }
}

export function loadTrials(jobDir: string, catalog: Catalog | null = loadCatalog(), opts: ReadOptions = {}): TrialRow[] {
  const rows: TrialRow[] = []
  for (const entry of readdirSync(jobDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const row = readTrial(join(jobDir, entry.name), catalog, opts)
    if (row) rows.push(row)
  }
  return rows.sort((a, b) => a.trial.localeCompare(b.trial))
}

export function exportJob(jobDir: string, catalog: Catalog | null = loadCatalog(), opts: ReadOptions = {}): JobExport {
  const rows = loadTrials(jobDir, catalog, opts)
  const jobResult = join(jobDir, 'result.json')
  let jobId: string | null = null
  if (existsSync(jobResult)) {
    try { jobId = str((JSON.parse(readFileSync(jobResult, 'utf8')) as Json).id) }
    catch (error) { if (!opts.verifiedOnly) throw error }
  }
  const agentVersions: Record<string, string[]> = {}
  for (const r of rows) {
    if (!r.agentVersion) continue
    const set = new Set(agentVersions[r.agent] ?? [])
    set.add(r.agentVersion)
    agentVersions[r.agent] = [...set].sort()
  }
  // Exports are shared, so record the job path relative to the home directory rather than naming the user.
  const absolute = resolve(jobDir)
  const source = absolute.startsWith(homedir()) ? `~${absolute.slice(homedir().length)}` : absolute
  return {
    schemaVersion: 1,
    job: basename(absolute),
    jobId,
    generatedAt: new Date().toISOString(),
    source,
    agentVersions,
    rows: rows.map(row => ({ ...row, source, run: jobId ?? basename(absolute) })),
  }
}
