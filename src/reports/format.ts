import type { TrialRow } from '../charts/trial'

export const MAX_IMPORT_BYTES = 750_000
export const MAX_REPORT_ROWS = 500
export type ReportData = { schemaVersion: 1; job: string; generatedAt: string; rows: TrialRow[] }

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a Harbor export JSON object.')
  return value as Record<string, unknown>
}
function label(value: unknown, name: string, optional = false): string | null {
  if (optional && value == null) return null
  if (typeof value !== 'string' || !value.trim() || value.length > 256 || [...value].some(c => c.charCodeAt(0) < 32)) throw new Error(`Invalid ${name}: use a short, nonempty label.`)
  return value.trim()
}
function number(value: unknown, name: string, optional = false): number | null {
  if (optional && value == null) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`Invalid ${name}: expected a nonnegative number.`)
  return value
}

/** Both the browser preview and the database write use this allowlist. Never persist raw config, paths, logs, or custom fields. */
export function parseReport(text: string): ReportData {
  if (new TextEncoder().encode(text).length > MAX_IMPORT_BYTES) throw new Error('Use a JSON export smaller than 750 KB.')
  const input = object(JSON.parse(text))
  if (input.schemaVersion !== 1 || !Array.isArray(input.rows)) throw new Error('Choose a normalized Harbor export (schemaVersion 1 with rows). Raw job folders and Studio bundles must be exported as Harbor JSON first.')
  if (!input.rows.length || input.rows.length > MAX_REPORT_ROWS) throw new Error('Import between 1 and 500 trials per report.')
  const seen = new Set<string>()
  const rows = input.rows.map((value, index) => {
    const raw = object(value)
    const trial = label(raw.trial, `trial ${index + 1}`)!
    if (seen.has(trial)) throw new Error(`Duplicate trial: ${trial}`)
    seen.add(trial)
    const reward = number(raw.reward, 'reward')!
    if (reward > 1 || raw.passed !== (reward >= 1 ? 1 : 0)) throw new Error(`Trial ${index + 1}: passed must match reward (0–1).`)
    for (const key of ['timedOut', 'overSlow']) if (raw[key] !== 0 && raw[key] !== 1) throw new Error(`Invalid ${key}: expected 0 or 1.`)
    const row: Record<string, string | number | null> = { trial, reward, passed: raw.passed as number, timedOut: raw.timedOut as number, overSlow: raw.overSlow as number, error: null }
    for (const key of ['task', 'taskFull', 'agent', 'model', 'modelShort', 'stack']) row[key] = label(raw[key], key)
    for (const key of ['taskChecksum', 'agentVersion', 'provider', 'vendor']) row[key] = label(raw[key], key, true)
    for (const key of ['agentSeconds', 'totalSeconds', 'inputTokens', 'cacheTokens', 'outputTokens', 'totalTokens', 'costUsd']) row[key] = number(raw[key], key, true)
    if (raw.costSource != null && raw.costSource !== 'reported' && raw.costSource !== 'derived') throw new Error('Invalid cost source.')
    row.costSource = (raw.costSource as string | null) ?? null
    row.startedAt = typeof raw.startedAt === 'string' && Number.isFinite(Date.parse(raw.startedAt)) ? new Date(raw.startedAt).toISOString() : null
    return row as TrialRow
  })
  if (typeof input.generatedAt !== 'string' || !Number.isFinite(Date.parse(input.generatedAt))) throw new Error('The export needs a valid generatedAt timestamp.')
  return { schemaVersion: 1, job: label(input.job, 'report name')!, generatedAt: new Date(input.generatedAt).toISOString(), rows }
}
