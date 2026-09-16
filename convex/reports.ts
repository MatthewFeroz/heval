import { v, ConvexError } from 'convex/values'
import { mutation, query, type QueryCtx } from './_generated/server'
import { parseReport } from '../src/reports/format'

async function owner(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity()
  if (!identity) throw new ConvexError('Sign in to manage your reports.')
  return identity.subject
}
export const list = query({ args: {}, handler: async ctx => {
  const user = await owner(ctx)
  const reports = await ctx.db.query('reports').withIndex('by_owner', q => q.eq('owner', user)).order('desc').take(100)
  return reports.map(r => ({ id: r._id, title: r.title, trials: r.trials, createdAt: r._creationTime, shared: !!r.shareToken }))
} })
export const save = mutation({ args: { json: v.string(), title: v.string() }, handler: async (ctx, args) => {
  const user = await owner(ctx)
  if ((await ctx.db.query('reports').withIndex('by_owner', q => q.eq('owner', user)).take(100)).length >= 100) throw new ConvexError('Your workspace has reached its 100-report limit.')
  let data
  try { data = parseReport(args.json) } catch (error) { throw new ConvexError(error instanceof Error ? error.message : 'Invalid export.') }
  const title = args.title.trim()
  if (!title || title.length > 120) throw new ConvexError('Use a report title between 1 and 120 characters.')
  const id = await ctx.db.insert('reports', { owner: user, title, trials: data.rows.length, shareToken: null })
  await ctx.db.insert('reportData', { report: id, json: JSON.stringify(data) })
  return id
} })
export const get = query({ args: { id: v.id('reports') }, handler: async (ctx, { id }) => {
  const user = await owner(ctx)
  const report = await ctx.db.get(id)
  if (!report || report.owner !== user) return null
  const data = await ctx.db.query('reportData').withIndex('by_report', q => q.eq('report', id)).unique()
  return data ? { id: report._id, title: report.title, data: data.json, shareToken: report.shareToken } : null
} })
export const shared = query({ args: { token: v.string() }, handler: async (ctx, { token }) => {
  if (!/^[a-f0-9]{64}$/.test(token)) return null
  const report = await ctx.db.query('reports').withIndex('by_share', q => q.eq('shareToken', token)).unique()
  if (!report) return null
  const data = await ctx.db.query('reportData').withIndex('by_report', q => q.eq('report', report._id)).unique()
  return data ? { title: report.title, data: data.json } : null
} })
export const share = mutation({ args: { id: v.id('reports'), token: v.string() }, handler: async (ctx, { id, token }) => {
  const user = await owner(ctx)
  const report = await ctx.db.get(id)
  if (!report || report.owner !== user) throw new ConvexError('Report not found.')
  if (report.shareToken) return report.shareToken
  if (!/^[a-f0-9]{64}$/.test(token)) throw new ConvexError('Invalid share token.')
  if (await ctx.db.query('usedShareTokens').withIndex('by_token', q => q.eq('token', token)).first()) throw new ConvexError('Please retry creating the link.')
  await ctx.db.insert('usedShareTokens', { token })
  await ctx.db.patch(id, { shareToken: token })
  return token
} })
export const revoke = mutation({ args: { id: v.id('reports') }, handler: async (ctx, { id }) => {
  const user = await owner(ctx)
  const report = await ctx.db.get(id)
  if (!report || report.owner !== user) throw new ConvexError('Report not found.')
  await ctx.db.patch(id, { shareToken: null })
} })
