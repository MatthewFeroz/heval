/**
 * Harness-comparison statistics in the HarnessTax form, from a combined export.
 *
 *   bun harbor/report/merge-jobs.ts results/study.json jobs/a jobs/b ...
 *   bun harbor/report/study-stats.ts results/study.json --baseline pi [--out dir]
 *
 * Method (arena.ai/blog/coding-agents-harness-tax): average each task's attempts,
 * then average across tasks; 95% intervals from 10,000 bootstrap resamples of
 * task averages. Differences from the baseline harness are paired by task, so
 * they resample the same tasks for both sides. The generator is seeded, so the
 * same export always reproduces the same intervals.
 *
 * Writes <name>-stats.md (tables for a write-up) and <name>-stats.csv.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { mean, median } from '../../src/charts/metrics'
import type { JobExport, TrialRow } from '../../src/charts/trial'

const RESAMPLES = 10_000
const SEED = 20260924

/** mulberry32: small, seedable, and good enough for bootstrap index draws. */
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export type Interval = { value: number; low: number; high: number }

/** Mean of per-task values with a percentile bootstrap interval over tasks. */
export function bootstrapMean(values: number[], seed = SEED): Interval | null {
  if (!values.length) return null
  const next = rng(seed), n = values.length
  const draws = new Float64Array(RESAMPLES)
  for (let r = 0; r < RESAMPLES; r++) {
    let sum = 0
    for (let i = 0; i < n; i++) sum += values[Math.floor(next() * n)]
    draws[r] = sum / n
  }
  draws.sort()
  return { value: mean(values)!, low: draws[Math.floor(0.025 * RESAMPLES)], high: draws[Math.ceil(0.975 * RESAMPLES) - 1] }
}

/** task -> mean of `key` over that task's attempts; tasks with no value are left out. */
export function taskMeans(rows: TrialRow[], key: keyof TrialRow): Map<string, number> {
  const byTask = new Map<string, number[]>()
  for (const r of rows) {
    const v = r[key]
    if (typeof v !== 'number' || !Number.isFinite(v)) continue
    byTask.set(r.task, [...(byTask.get(r.task) ?? []), v])
  }
  return new Map([...byTask].map(([task, vs]) => [task, mean(vs)!]))
}

export type HarnessStats = {
  harness: string
  versions: string
  tasks: number
  attempts: number
  errored: number
  success: Interval | null
  cost: Interval | null
  /** Paired difference in success from the baseline, over tasks both ran. */
  successDelta: Interval | null
  /** Ratio of mean cost to the baseline's, over tasks both have costs for. */
  costRatio: number | null
  medianTurns: number | null
  medianRequests: number | null
  capHits: string
}

/**
 * Gateway-billed cost (`proxyCostUsd`) when the export has it: one measure for
 * every harness. Otherwise `costUsd`, which may be harness-reported at the
 * harness's own rates and is not comparable across harnesses.
 */
export const costMeasure = (rows: TrialRow[]): 'proxyCostUsd' | 'costUsd' =>
  rows.some(r => typeof r.proxyCostUsd === 'number') ? 'proxyCostUsd' : 'costUsd'

export function studyStats(rows: TrialRow[], baseline: string, costKey: keyof TrialRow = costMeasure(rows)): HarnessStats[] {
  const harnesses = [...new Set(rows.map(r => r.agent))].sort()
  if (!harnesses.includes(baseline)) throw new Error(`Baseline ${baseline} not in export (${harnesses.join(', ')})`)
  const of = (h: string) => rows.filter(r => r.agent === h)
  const baseSuccess = taskMeans(of(baseline), 'passed'), baseCost = taskMeans(of(baseline), costKey)
  return harnesses.map(harness => {
    const group = of(harness)
    const success = taskMeans(group, 'passed'), cost = taskMeans(group, costKey)
    const shared = [...success.keys()].filter(t => baseSuccess.has(t))
    const costShared = [...cost.keys()].filter(t => baseCost.has(t))
    const capped = group.filter(r => r.capHit === 0 || r.capHit === 1)
    const known = (k: keyof TrialRow) => group.map(r => r[k]).filter((v): v is number => typeof v === 'number')
    return {
      harness,
      versions: [...new Set(group.map(r => r.agentVersion ?? 'unknown'))].join(', '),
      tasks: new Set(group.map(r => r.task)).size,
      attempts: group.length,
      errored: group.filter(r => r.error).length,
      success: bootstrapMean([...success.values()]),
      cost: bootstrapMean([...cost.values()]),
      successDelta: harness === baseline || !shared.length ? null
        : bootstrapMean(shared.map(t => success.get(t)! - baseSuccess.get(t)!)),
      costRatio: harness === baseline || !costShared.length ? null
        : mean(costShared.map(t => cost.get(t)!))! / mean(costShared.map(t => baseCost.get(t)!))!,
      medianTurns: median(known('turns')),
      medianRequests: median(known('modelRequests')),
      capHits: capped.length ? `${capped.filter(r => r.capHit === 1).length}/${capped.length}` : 'uncapped',
    }
  })
}

const pct = (i: Interval | null) => (i ? `${(i.value * 100).toFixed(1)}% [${(i.low * 100).toFixed(1)}, ${(i.high * 100).toFixed(1)}]` : 'n/a')
const pp = (i: Interval | null) => (i ? `${i.value >= 0 ? '+' : ''}${(i.value * 100).toFixed(1)} pp [${(i.low * 100).toFixed(1)}, ${(i.high * 100).toFixed(1)}]` : '—')
const usd = (i: Interval | null) => (i ? `$${i.value.toFixed(3)} [${i.low.toFixed(3)}, ${i.high.toFixed(3)}]` : 'n/a')
const num = (v: number | null, d = 1) => (v === null ? 'n/a' : v.toFixed(d))

const COST_NOTE = {
  proxyCostUsd: 'Cost is what Merge Gateway billed per response, summed per attempt by the vendor proxy (Anthropic-endpoint responses carry tokens only and are priced at the pinned route\'s catalog rate).',
  costUsd: 'Cost is harness-reported where available, else tokens priced at the catalog rate; harness-reported figures use each harness\'s own rates and are not comparable across harnesses.',
}

export function toMarkdown(stats: HarnessStats[], baseline: string, source: string, costKey: keyof typeof COST_NOTE = 'proxyCostUsd'): string {
  const head = `| Harness | Version | Tasks | Attempts | Errored | Success (95% CI) | Δ vs ${baseline} | Cost / attempt (95% CI) | Cost vs ${baseline} | Median turns | Median requests | Turn-cap hits |`
  const lines = stats.map(s => `| ${s.harness} | ${s.versions} | ${s.tasks} | ${s.attempts} | ${s.errored} | ${pct(s.success)} | ${pp(s.successDelta)} | ${usd(s.cost)} | ${s.costRatio === null ? '—' : `${s.costRatio.toFixed(2)}×`} | ${num(s.medianTurns)} | ${num(s.medianRequests)} | ${s.capHits} |`)
  return [
    `# Harness comparison: ${source}`, '',
    `Success and cost average each task's attempts, then the tasks. Intervals are 95% percentile bootstraps over tasks (${RESAMPLES.toLocaleString()} resamples, seed ${SEED}); differences from ${baseline} are paired by task. Turns follow each harness's own definition and are not comparable across harnesses; model requests come from the vendor proxy and are. ${COST_NOTE[costKey]} "n/a" cost means no usage was recorded.`, '',
    head, `|${head.split('|').slice(1, -1).map(() => '---').join('|')}|`, ...lines, '',
  ].join('\n')
}

export function toCsv(stats: HarnessStats[]): string {
  const cols = ['harness', 'versions', 'tasks', 'attempts', 'errored', 'success', 'success_low', 'success_high',
    'success_delta', 'success_delta_low', 'success_delta_high', 'cost_usd', 'cost_low', 'cost_high', 'cost_ratio',
    'median_turns', 'median_requests', 'cap_hits']
  const cell = (v: unknown) => (v === null || v === undefined ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
  return [cols.join(','), ...stats.map(s => [s.harness, s.versions, s.tasks, s.attempts, s.errored,
    s.success?.value, s.success?.low, s.success?.high, s.successDelta?.value, s.successDelta?.low, s.successDelta?.high,
    s.cost?.value, s.cost?.low, s.cost?.high, s.costRatio, s.medianTurns, s.medianRequests, s.capHits].map(cell).join(','))].join('\n') + '\n'
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const flag = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
  const input = args.find((a, i) => !a.startsWith('--') && !['--baseline', '--out'].includes(args[i - 1]))
  const baseline = flag('--baseline')
  if (!input || !baseline) {
    console.error('usage: bun harbor/report/study-stats.ts <combined-export.json> --baseline <harness> [--out dir]')
    process.exit(2)
  }
  const job = JSON.parse(readFileSync(input, 'utf8')) as JobExport
  const costKey = costMeasure(job.rows)
  const stats = studyStats(job.rows, baseline, costKey)
  const out = flag('--out') ?? 'results/harbor'
  mkdirSync(out, { recursive: true })
  const name = basename(input, '.json')
  const md = toMarkdown(stats, baseline, job.job, costKey)
  writeFileSync(join(out, `${name}-stats.md`), md)
  writeFileSync(join(out, `${name}-stats.csv`), toCsv(stats))
  console.log(md)
}
