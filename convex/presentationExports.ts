import { PRESENTATION_DEFAULT_THEME } from '../src/charts/presentation-defaults'
import { ConvexError, v } from 'convex/values'
import { mutation, query, internalMutation, internalQuery } from './_generated/server'
import { internal } from './_generated/api'
import { identity, projectState, requireAccess } from './reportAccess'
import { validateReportProject, renderReportProject } from '../src/reports/project'
import { resolveSocial, SOCIAL_DEFAULTS } from '../src/charts/social-presets'
import { motionInput } from '../src/project/motion-input'

function configured() {
  return ['HEVAL_EXPORT_SNAPSHOT_ID', 'VERCEL_TOKEN', 'VERCEL_PROJECT_ID', 'VERCEL_TEAM_ID', 'BLOB_READ_WRITE_TOKEN'].every(key => !!process.env[key])
}
export const available = query({ args: {}, handler: async ctx => { await identity(ctx); return configured() } })
export const list = query({ args: { report: v.id('reports') }, handler: async (ctx, { report }) => {
  await requireAccess(ctx, report)
  const jobs = await ctx.db.query('presentationExports').withIndex('by_report', q => q.eq('report', report)).order('desc').take(50)
  return jobs.map(job => ({ _id: job._id, _creationTime: job._creationTime, version: job.version, status: job.status, preset: job.preset, theme: job.theme, collection: job.collection, filename: job.filename, error: job.error, bytes: job.bytes }))
} })
// Used by the authenticated download proxy. Blob paths are private, never public URLs.
export const artifact = query({ args: { job: v.id('presentationExports') }, handler: async (ctx, { job }) => {
  const row = await ctx.db.get(job)
  if (!row) throw new ConvexError('Export unavailable.')
  await requireAccess(ctx, row.report)
  if (row.status !== 'complete' || !row.pathname) throw new ConvexError('Export is not ready.')
  return { pathname: row.pathname, filename: row.filename!, contentType: row.contentType! }
} })
export const request = mutation({ args: { report: v.id('reports'), expectedVersion: v.number(), document: v.string(), collection: v.boolean(), requestId: v.string() }, handler: async (ctx, args) => {
  const { report, user } = await requireAccess(ctx, args.report, 'editor')
  if (!configured()) throw new ConvexError('Hosted exports have not been configured yet.')
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(args.requestId)) throw new ConvexError('Invalid export request.')
  const existing = await ctx.db.query('presentationExports').withIndex('by_request', q => q.eq('owner', user.subject).eq('requestId', args.requestId)).unique()
  if (existing) {
    if (existing.report !== args.report) throw new ConvexError('Invalid export request.')
    return { job: existing._id, version: existing.version }
  }
  const recent = await ctx.db.query('presentationExports').withIndex('by_owner', q => q.eq('owner', user.subject)).order('desc').take(20)
  if (recent.length === 20 && recent[19]._creationTime > Date.now() - 86400000) throw new ConvexError('Your daily limit of 20 exports has been reached.')
  if ((await ctx.db.query('presentationExports').withIndex('by_status', q => q.eq('status', 'queued')).take(20)).length >= 20) throw new ConvexError('The export queue is full. Try again shortly.')
  const state = await projectState(ctx, report)
  if (args.expectedVersion !== state.version) throw new ConvexError('A teammate saved a newer version. Reload before exporting.')
  const document = validateReportProject(args.document, state.initial)
  if (document.mode !== 'presentation' || !document.presentationId) throw new ConvexError('Choose a presentation first.')
  const rendered = await renderReportProject(JSON.parse(state.data), document)
  const settings = rendered.presentation?.social ?? SOCIAL_DEFAULTS
  if (!rendered.rows.length) throw new ConvexError('Choose at least one trial.')
  const charts = (args.collection ? settings.collection : [settings.preset]).map(preset => resolveSocial(rendered.rows, { ...settings, preset }))
  const pages = charts.reduce((n, c) => n + (c.preset === 'disagreement' ? Math.max(1, Math.ceil(c.matrix.length / 12)) : 1), 0)
  if (pages > 12) throw new ConvexError('Export up to 12 images at a time. Choose fewer questions or tasks.')
  const payload = JSON.stringify({ input: motionInput(settings.source || report.title, rendered.rows), settings, collection: args.collection })
  if (new TextEncoder().encode(payload).length > 750_000) throw new ConvexError('This export is too large. Filter to fewer trials.')
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload)))
  const inputHash = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
  // Saving the exact settings and enqueueing the export are one transaction.
  const version = state.version + 1, draft = JSON.stringify(document)
  const fields = { draft, version, updatedBy: user.subject }
  if (state.stored) await ctx.db.patch(state.stored._id, fields)
  else await ctx.db.insert('reportProjects', { report: report._id, ...fields, ...(report.shareToken ? { published: JSON.stringify(state.initial), publishedVersion: 0 } : {}) })
  await ctx.db.patch(report._id, { title: document.project.label })
  const job = await ctx.db.insert('presentationExports', { report: report._id, owner: user.subject, requestId: args.requestId, version, status: 'queued', collection: args.collection, preset: settings.preset, theme: settings.theme ?? PRESENTATION_DEFAULT_THEME, snapshotId: process.env.HEVAL_EXPORT_SNAPSHOT_ID!, inputHash })
  await ctx.db.insert('presentationExportInputs', { job, payload, document: draft })
  await ctx.scheduler.runAfter(0, internal.presentationExports.pump, {})
  return { job, version }
} })
// A transactional claim ensures only one renderer runs per deployment.
export const pump = internalMutation({ args: {}, handler: async ctx => {
  if (await ctx.db.query('presentationExports').withIndex('by_status', q => q.eq('status', 'rendering')).first()) return
  const job = await ctx.db.query('presentationExports').withIndex('by_status', q => q.eq('status', 'queued')).first()
  if (!job) return
  await ctx.db.patch(job._id, { status: 'rendering', startedAt: Date.now() })
  await ctx.scheduler.runAfter(0, internal.presentationExportWorker.render, { job: job._id })
  // Scheduled actions are not automatically retried: release the queue even after a crash.
  await ctx.scheduler.runAfter(8 * 60_000, internal.presentationExports.expire, { job: job._id })
} })
export const input = internalQuery({ args: { job: v.id('presentationExports') }, handler: async (ctx, { job }) => {
  const row = await ctx.db.get(job)
  if (!row || row.status !== 'rendering') return null
  const input = await ctx.db.query('presentationExportInputs').withIndex('by_job', q => q.eq('job', job)).unique()
  return input ? { ...row, payload: input.payload } : null
} })
export const finish = internalMutation({ args: { job: v.id('presentationExports'), artifact: v.optional(v.object({ pathname: v.string(), filename: v.string(), contentType: v.string(), bytes: v.number() })), error: v.optional(v.string()) }, handler: async (ctx, { job, artifact, error }) => {
  const row = await ctx.db.get(job)
  if (!row || row.status !== 'rendering') return false
  await ctx.db.patch(job, { status: artifact ? 'complete' : 'failed', finishedAt: Date.now(), ...artifact, ...(error ? { error } : {}) })
  await ctx.scheduler.runAfter(0, internal.presentationExports.pump, {})
  return true
} })
export const expire = internalMutation({ args: { job: v.id('presentationExports') }, handler: async (ctx, { job }) => {
  const row = await ctx.db.get(job)
  if (row?.status !== 'rendering') return
  await ctx.db.patch(job, { status: 'failed', finishedAt: Date.now(), error: 'Rendering timed out. You can submit a new export.' })
  await ctx.scheduler.runAfter(0, internal.presentationExports.pump, {})
} })
