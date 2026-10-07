import type { MutationCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { terminalStates } from '../src/runners/protocol'
import { MAX_IMPORT_BYTES, parseReport, parseStoredReport, type ReportData } from '../src/reports/format'
import { hasReportCapacity } from './reportCapacity'

/**
 * Turn the per-combination reports produced by the runner into the single
 * report a person expects an experiment to own. The raw reports remain useful
 * for run-level diagnosis; this report is the product-level result.
 */
export async function materializeExperimentReport(ctx: MutationCtx, id: Id<'experiments'>) {
  const experiment = await ctx.db.get(id)
  if (!experiment || experiment.report) return experiment?.report ?? null

  const runs = await ctx.db.query('runnerRuns').withIndex('by_experiment', q => q.eq('experiment', id)).collect()
  if (!runs.length || runs.some(run => !terminalStates.includes(run.status as typeof terminalStates[number]))) return null

  const rows: ReportData['rows'] = []
  const encoder = new TextEncoder()
  let generatedAt = experiment._creationTime
  let rowBytes = 0
  const document = () => ({ schemaVersion: 1, job: experiment.title, generatedAt: new Date(generatedAt).toISOString(), rows })
  for (const run of runs) {
    if (!run.report) continue
    const stored = await ctx.db.query('reportData').withIndex('by_report', q => q.eq('report', run.report!)).unique()
    if (!stored) continue
    const data = parseStoredReport(stored.json)
    generatedAt = Math.max(generatedAt, Date.parse(data.generatedAt))
    const envelopeBytes = encoder.encode(JSON.stringify({ ...document(), rows: [] })).length
    if (envelopeBytes + rowBytes > MAX_IMPORT_BYTES) return null
    for (const [index, row] of data.rows.entries()) {
      const combined = {
        ...row,
        // Put the combination and row number first so truncation cannot
        // collapse two source trial IDs onto the same value.
        trial: `${run.profile.id}:${index + 1}:${row.trial}`.slice(0, 256),
      }
      rowBytes += encoder.encode(JSON.stringify(combined)).length + (rows.length ? 1 : 0)
      // Once the transformed JSON cannot fit, later reports cannot change that.
      // Stop before reading them so large experiments still finish durably.
      if (envelopeBytes + rowBytes > MAX_IMPORT_BYTES) return null
      rows.push(combined)
    }
  }
  if (!rows.length) return null

  const json = JSON.stringify(document())
  // Preserve reserved outputs for unfinished work before storing this optional combined report.
  if (!await hasReportCapacity(ctx, experiment.owner, 1)) return null
  const data = parseReport(json)
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
