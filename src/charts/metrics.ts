/**
 * The headline metrics, defined once.
 *
 * Three of the numbers a reader actually quotes are not per-trial fields, so no
 * single aggregation over `TrialRow` expresses them: a ratio of two aggregates
 * (spend / passes), and a median taken over passed trials only. They used to
 * live inline in the report builder. The poster exporter needs the same three,
 * and a poster that disagreed with the report it was cut from would be worse
 * than no poster, so the derivations moved here and both callers import them.
 *
 * Browser-safe: pure functions of rows, no fs, no DOM.
 */

import type { TrialRow } from './trial'

export const nums = (rows: TrialRow[], key: keyof TrialRow): number[] =>
  rows.map((r) => r[key]).filter((v): v is number => typeof v === 'number')

export const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

export const median = (xs: number[]): number | null => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/** Linear-interpolated quantile; `p` in 0..1. */
export const quantile = (xs: number[], p: number): number | null => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const i = (s.length - 1) * p
  const lo = Math.floor(i)
  const hi = Math.ceil(i)
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo)
}

/**
 * One synthetic row per group, carrying a pre-computed statistic in the field
 * the chart will plot. The recipe system aggregates a per-trial field over a
 * dimension, so a derived per-group number reaches a chart only by arriving as
 * a group of one - `mean` of a single value is that value. Everything else on
 * the row is inherited from a real member of the group so the dimension the
 * chart groups by still resolves.
 */
export function collapseTo(
  rows: TrialRow[],
  field: 'costUsd' | 'agentSeconds',
  value: (group: TrialRow[]) => number | null,
): TrialRow[] {
  const out: TrialRow[] = []
  for (const key of [...new Set(rows.map((r) => r.stack))].sort()) {
    const group = rows.filter((r) => r.stack === key)
    const v = value(group)
    if (v !== null) out.push({ ...group[0], [field]: v })
  }
  return out
}

// -- the three derived group statistics -------------------------------------------

/** Share of trials that passed, 0..1. */
export const completionRate = (group: TrialRow[]): number | null =>
  group.length ? group.filter((r) => r.passed).length / group.length : null

/**
 * Total spend divided by passes - what a reader actually buys.
 *
 * A stack that fails fast and cheaply looks good on mean per-trial cost and bad
 * here, which is the point. Null when nothing passed: an unpriceable stack is
 * absent from the chart rather than plotted as zero or infinity.
 */
export const costPerSuccess = (group: TrialRow[]): number | null => {
  const costs = nums(group, 'costUsd')
  const passes = group.filter((r) => r.passed).length
  return costs.length && passes ? costs.reduce((a, b) => a + b, 0) / passes : null
}

/**
 * Median agent-step wall clock over passed trials only.
 *
 * Failures are excluded on purpose: a timed-out run contributes the harness cap
 * rather than a duration, which would rank a stack faster for giving up sooner.
 */
export const medianTimePassed = (group: TrialRow[]): number | null =>
  median(nums(group.filter((r) => r.passed), 'agentSeconds'))
