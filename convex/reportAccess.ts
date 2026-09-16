import { ConvexError } from 'convex/values'
import type { QueryCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { initialReportProject, type ReportProject } from '../src/reports/project'

export async function identity(ctx: QueryCtx) {
  const user = await ctx.auth.getUserIdentity()
  if (!user) throw new ConvexError('Sign in to manage your reports.')
  return user
}
export async function access(ctx: QueryCtx, id: Id<'reports'>) {
  const user = await identity(ctx), report = await ctx.db.get(id)
  if (!report) return null
  const role = report.owner === user.subject ? 'owner' : (await ctx.db.query('reportMembers').withIndex('by_report', q => q.eq('report', id).eq('user', user.subject)).unique())?.role
  return role ? { report, role, user } : null
}
export async function requireAccess(ctx: QueryCtx, id: Id<'reports'>, level: 'owner' | 'editor' | 'viewer' = 'viewer') {
  const allowed = await access(ctx, id)
  if (!allowed) throw new ConvexError('Report not found.')
  if ((level === 'owner' && allowed.role !== 'owner') || (level === 'editor' && allowed.role === 'viewer')) throw new ConvexError('You do not have permission to change this report.')
  return allowed
}
export async function projectState(ctx: QueryCtx, report: { _id: Id<'reports'>; title: string }) {
  const data = await ctx.db.query('reportData').withIndex('by_report', q => q.eq('report', report._id)).unique()
  if (!data) throw new ConvexError('Report data is unavailable.')
  const stored = await ctx.db.query('reportProjects').withIndex('by_report', q => q.eq('report', report._id)).unique()
  const initial = await initialReportProject(JSON.parse(data.json), report._id, report.title)
  return { data: data.json, stored, initial, document: stored ? JSON.parse(stored.draft) as ReportProject : initial, version: stored?.version ?? 0 }
}
