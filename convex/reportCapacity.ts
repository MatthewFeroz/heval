import { ConvexError } from 'convex/values'
import type { QueryCtx } from './_generated/server'
import { terminalStates } from '../src/runners/protocol'

export const MAX_REPORTS = 100

export async function storedReportCount(ctx: QueryCtx, owner: string) {
  return (await ctx.db.query('reports').withIndex('by_owner', q => q.eq('owner', owner)).take(MAX_REPORTS)).length
}

/** Check output space after retaining every unfinished run's reservations. */
export async function hasReportCapacity(ctx: QueryCtx, owner: string, additional: number) {
  const [stored, runs] = await Promise.all([
    storedReportCount(ctx, owner),
    ctx.db.query('runnerRuns').withIndex('by_owner', q => q.eq('owner', owner)).take(200),
  ])
  const unfinished = runs.filter(run => !(terminalStates as readonly string[]).includes(run.status))
  const experimentIds = [...new Set(unfinished.flatMap(run => run.experiment ? [run.experiment] : []))]
  const experiments = await Promise.all(experimentIds.map(id => ctx.db.get(id)))
  // Every unfinished run can return an individual report. Each unfinished
  // experiment also needs one combined report, independently of its run count.
  // Terminal transitions already attempt materialization, so cancelled runs
  // without rows and oversized results no longer reserve a combined output.
  const combined = experiments.filter(experiment => experiment && !experiment.report).length
  return stored + unfinished.length + combined + additional <= MAX_REPORTS
}

/** Reserve output space in the same transaction that accepts work or an import. */
export async function assertReportCapacity(ctx: QueryCtx, owner: string, additional: number, message: string) {
  if (!await hasReportCapacity(ctx, owner, additional)) throw new ConvexError(message)
}
