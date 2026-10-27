import { ConvexError, v } from 'convex/values'
import { mutation, query } from './_generated/server'
import { identity } from './reportAccess'
import { terminalStates } from '../src/runners/protocol'
import { summarizeRun } from './runResults'
import { parseStoredReport } from '../src/reports/format'

export const list = query({ args: {}, handler: async ctx => {
  const owner = (await identity(ctx)).subject
  return (await ctx.db.query('comparisonBaselines').withIndex('by_owner', q => q.eq('owner', owner)).order('desc').take(50)).map(b => ({ id: b._id, title: b.title, goal: b.goal, report: b.report, experiment: b.experiment, createdAt: b._creationTime }))
} })

export const get = query({ args: { id: v.id('comparisonBaselines') }, handler: async (ctx, { id }) => {
  const owner = (await identity(ctx)).subject, row = await ctx.db.get(id)
  if (!row || row.owner !== owner) throw new ConvexError('Baseline not found.')
  return row
} })

/** Baselines capture immutable execution conditions and outcomes, not a chart draft. */
export const save = mutation({ args: { experiment: v.id('experiments'), title: v.string() }, handler: async (ctx, { experiment, title }) => {
  const owner = (await identity(ctx)).subject, source = await ctx.db.get(experiment)
  if (!source || source.owner !== owner) throw new ConvexError('Experiment not found.')
  if (!title.trim() || title.length > 120) throw new ConvexError('Name the baseline in 1–120 characters.')
  const prior = await ctx.db.query('comparisonBaselines').withIndex('by_experiment', q => q.eq('experiment', experiment)).unique()
  if (prior) return prior._id
  if ((await ctx.db.query('comparisonBaselines').withIndex('by_owner', q => q.eq('owner', owner)).take(50)).length >= 50) throw new ConvexError('Keep at most 50 baselines.')
  const runs = await ctx.db.query('runnerRuns').withIndex('by_experiment', q => q.eq('experiment', experiment)).collect()
  if (!source.report || !runs.length || runs.some(r => !(terminalStates as readonly string[]).includes(r.status))) throw new ConvexError('Wait for the comparison to finish and save its report before creating a baseline.')
  const results = await Promise.all(runs.map(async r => {
    const data = r.report && !r.resultSummary ? await ctx.db.query('reportData').withIndex('by_report', q => q.eq('report', r.report!)).unique() : null
    return { profile: r.profile, status: r.status, result: r.resultSummary ?? (data ? summarizeRun(parseStoredReport(data.json).rows) : null) }
  }))
  const managed = await ctx.db.query('managedComparisons').withIndex('by_experiment', q => q.eq('experiment', experiment)).unique()
  return ctx.db.insert('comparisonBaselines', { owner, title: title.trim(), experiment, report: source.report, execution: managed ? 'managed' : 'connected', goal: source.goal ?? 'custom', taskSet: source.taskSet, attempts: source.attempts, ...(runs[0].runSettings ? { runSettings: runs[0].runSettings } : {}), profiles: runs.map(r => r.profile), results })
} })
