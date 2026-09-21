import type { MutationCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { terminalStates } from '../src/runners/protocol'
import { parseReport, type ReportData } from '../src/reports/format'

/**
 * Turn the per-combination reports produced by the runner into the single
 * report a person expects an experiment to own. The raw reports remain useful
 * for run-level diagnosis; this report is the product-level result.
 */
export async function materializeExperimentReport(ctx: MutationCtx, id: Id<'experiments'>) {
  const experiment = await ctx.db.get(id)
  if (!experiment || experiment.report) return experiment?.report ?? null

  const runs = await ctx.db.query('runnerRuns').withIndex('by_experiment', q => q.eq('experiment', id)).take(10)
  if (!runs.length || runs.some(run => !terminalStates.includes(run.status as typeof terminalStates[number]))) return null

  const rows: ReportData['rows'] = []
  let generatedAt = experiment._creationTime
  for (const run of runs) {
    if (!run.report) continue
    const stored = await ctx.db.query('reportData').withIndex('by_report', q => q.eq('report', run.report!)).unique()
    if (!stored) continue
    const data = parseReport(stored.json)
    generatedAt = Math.max(generatedAt, Date.parse(data.generatedAt))
    data.rows.forEach((row, index) => rows.push({
      ...row,
      // Trial IDs only need to be unique inside the normalized export. Put the
      // combination and row number first so truncating a long source ID cannot
      // collapse two rows onto the same value.
      trial: `${run.profile.id}:${index + 1}:${row.trial}`.slice(0, 256),
    }))
  }
  if (!rows.length) return null

  const data = parseReport(JSON.stringify({
    schemaVersion: 1,
    job: experiment.title,
    generatedAt: new Date(generatedAt).toISOString(),
    rows,
  }))
  const report = await ctx.db.insert('reports', {
    owner: experiment.owner,
    title: experiment.title,
    trials: data.rows.length,
    shareToken: null,
  })
  await ctx.db.insert('reportData', { report, json: JSON.stringify(data) })
  await ctx.db.patch(id, { report })
  return report
}
