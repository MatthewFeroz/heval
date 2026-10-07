import { v, type Infer } from 'convex/values'
import type { TrialRow } from '../src/charts/trial'

const nullableNumber = v.union(v.number(), v.null())
const MAX_SUMMARY_VERSIONS = 16
export const runResultValidator = v.object({
  inputTokens: nullableNumber, outputTokens: nullableNumber, versions: v.array(v.string()), additionalVersions: v.number(),
  trials: v.number(), passed: v.number(), medianSeconds: nullableNumber, reportedCost: nullableNumber,
})
export type RunResultSummary = Infer<typeof runResultValidator>

/** The experiment's metrics describe recorded rows, including partial outcomes. */
export function summarizeRun(rows: readonly TrialRow[]): RunResultSummary {
  const total = (field: 'inputTokens' | 'outputTokens' | 'costUsd') => rows.length && rows.every(row => typeof row[field] === 'number') ? rows.reduce((sum, row) => sum + row[field]!, 0) : null
  const times = rows.flatMap(row => row.passed === 1 && typeof row.agentSeconds === 'number' ? [row.agentSeconds] : []).sort((a, b) => a - b)
  const mid = Math.floor(times.length / 2)
  const versions = [...new Set(rows.flatMap(row => row.agentVersion ? [row.agentVersion] : []))]
  return {
    inputTokens: total('inputTokens'), outputTokens: total('outputTokens'),
    versions: versions.slice(0, MAX_SUMMARY_VERSIONS), additionalVersions: Math.max(0, versions.length - MAX_SUMMARY_VERSIONS),
    trials: rows.length, passed: rows.filter(row => row.passed === 1).length,
    medianSeconds: times.length ? times.length % 2 ? times[mid] : (times[mid - 1] + times[mid]) / 2 : null,
    reportedCost: total('costUsd'),
  }
}
