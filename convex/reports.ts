import { v, ConvexError } from 'convex/values'
import { mutation, query } from './_generated/server'
import { access, identity, projectState } from './reportAccess'
import { parseReport } from '../src/reports/format'
import { renderReportProject, initialReportProject, validateReportProject, type ReportProject } from '../src/reports/project'
import type { AnalysisView } from '../src/project/schema'

export const list = query({ args: {}, handler: async ctx => {
  const user = (await identity(ctx)).subject
  const reports = await ctx.db.query('reports').withIndex('by_owner', q => q.eq('owner', user)).order('desc').take(100)
  const memberships = await ctx.db.query('reportMembers').withIndex('by_user', q => q.eq('user', user)).take(100)
  const joined = await Promise.all(memberships.map(async m => ({ report: await ctx.db.get(m.report), role: m.role })))
  return [...reports.map(r => ({ id: r._id, title: r.title, trials: r.trials, createdAt: r._creationTime, shared: !!r.shareToken, role: 'owner' as const })), ...joined.flatMap(({ report: r, role }) => r ? [{ id: r._id, title: r.title, trials: r.trials, createdAt: r._creationTime, shared: !!r.shareToken, role }] : [])]
} })
export const save = mutation({ args: { json: v.string(), title: v.string() }, handler: async (ctx, args) => {
  const user = (await identity(ctx)).subject
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
  const allowed = await access(ctx, id)
  if (!allowed) return null
  const state = await projectState(ctx, allowed.report)
  return { id, title: allowed.report.title, data: state.data, shareToken: allowed.role === 'owner' ? allowed.report.shareToken : null, role: allowed.role,
    project: JSON.stringify(state.document), version: state.version, publishedVersion: state.stored?.publishedVersion ?? (allowed.report.shareToken ? 0 : null), updatedBy: state.stored?.updatedBy ?? null }
} })
export const shared = query({ args: { token: v.string() }, handler: async (ctx, { token }) => {
  if (!/^[a-f0-9]{64}$/.test(token)) return null
  const report = await ctx.db.query('reports').withIndex('by_share', q => q.eq('shareToken', token)).unique()
  if (!report) return null
  const state = await projectState(ctx, report)
  const project = state.stored?.published ?? JSON.stringify(state.initial)
  return { title: (JSON.parse(project) as typeof state.document).project.label, data: state.data, project, version: state.stored?.publishedVersion ?? 0 }
} })
export const share = mutation({ args: { id: v.id('reports'), token: v.string() }, handler: async (ctx, { id, token }) => {
  const user = (await identity(ctx)).subject
  const report = await ctx.db.get(id)
  if (!report || report.owner !== user) throw new ConvexError('Report not found.')
  if (report.shareToken) return report.shareToken
  if (!/^[a-f0-9]{64}$/.test(token)) throw new ConvexError('Invalid share token.')
  if (await ctx.db.query('usedShareTokens').withIndex('by_token', q => q.eq('token', token)).first()) throw new ConvexError('Please retry creating the link.')
  await ctx.db.insert('usedShareTokens', { token })
  const state = await projectState(ctx, report)
  if (!state.stored?.published) {
    if (!(await renderReportProject(JSON.parse(state.data), state.document)).rows.length) throw new ConvexError('Choose at least one trial before sharing.')
    const document = JSON.stringify(state.document)
    if (state.stored) await ctx.db.patch(state.stored._id, { published: document, publishedVersion: state.version })
    else await ctx.db.insert('reportProjects', { report: id, draft: document, version: 0, updatedBy: user, published: document, publishedVersion: 0 })
    await ctx.db.insert('reportRevisions', { report: id, version: state.version, document, publishedBy: user })
  }
  await ctx.db.patch(id, { shareToken: token })
  return token
} })
export const revoke = mutation({ args: { id: v.id('reports') }, handler: async (ctx, { id }) => {
  const user = (await identity(ctx)).subject
  const report = await ctx.db.get(id)
  if (!report || report.owner !== user) throw new ConvexError('Report not found.')
  await ctx.db.patch(id, { shareToken: null })
} })

/** Import a single-source Studio project and its data atomically. */
export const saveProject = mutation({ args: { json: v.string(), document: v.string() }, handler: async (ctx, args) => {
  const user = (await identity(ctx)).subject
  if ((await ctx.db.query('reports').withIndex('by_owner', q => q.eq('owner', user)).take(100)).length >= 100) throw new ConvexError('Your workspace has reached its 100-report limit.')
  const data = parseReport(args.json)
  if (new TextEncoder().encode(args.document).length > 150_000) throw new ConvexError('Project settings must be smaller than 150 KB.')
  const incoming = JSON.parse(args.document) as ReportProject
  if (incoming.project.sources.length !== 1) throw new ConvexError('Save one evaluation source at a time.')
  const id = await ctx.db.insert('reports', { owner: user, title: 'Presentation', trials: data.rows.length, shareToken: null })
  const base = await initialReportProject(data, id, 'Presentation'), source = base.project.sources[0]
  const remap = (view: AnalysisView): AnalysisView => ({ ...view, sourceIds: view.sourceIds.length ? [source.id] : [] })
  const document = validateReportProject(JSON.stringify({ ...incoming, project: { ...incoming.project, id, sources: base.project.sources,
    analysisViews: incoming.project.analysisViews.map(remap), presentations: incoming.project.presentations.map(p => ({ ...p, ...(p.analysisSnapshot ? { analysisSnapshot: remap(p.analysisSnapshot) } : {}) })) } }), base)
  await renderReportProject(data, document)
  await ctx.db.patch(id, { title: document.project.label })
  await ctx.db.insert('reportData', { report: id, json: JSON.stringify(data) })
  await ctx.db.insert('reportProjects', { report: id, draft: JSON.stringify(document), version: 0, updatedBy: user })
  return id
} })
