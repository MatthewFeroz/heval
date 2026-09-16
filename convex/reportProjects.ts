import { v, ConvexError } from 'convex/values'
import { mutation, query } from './_generated/server'
import { identity, projectState, requireAccess } from './reportAccess'
import { renderReportProject, validateReportProject } from '../src/reports/project'

export const saveDraft = mutation({ args: { id: v.id('reports'), expectedVersion: v.number(), document: v.string() }, handler: async (ctx, args) => {
  const { report, user } = await requireAccess(ctx, args.id, 'editor')
  const state = await projectState(ctx, report)
  if (args.expectedVersion !== state.version) throw new ConvexError('A teammate saved a newer version. Download your draft before reloading the latest version.')
  let document
  try {
    document = validateReportProject(args.document, state.initial)
    await renderReportProject(JSON.parse(state.data), document)
  } catch (e) { throw new ConvexError(e instanceof Error ? e.message : 'Invalid project.') }
  const version = state.version + 1
  const fields = { draft: JSON.stringify(document), version, updatedBy: user.subject }
  if (state.stored) await ctx.db.patch(state.stored._id, fields)
  else await ctx.db.insert('reportProjects', { report: args.id, ...fields,
    ...(report.shareToken ? { published: JSON.stringify(state.initial), publishedVersion: 0 } : {}) })
  await ctx.db.patch(args.id, { title: document.project.label })
  return { version, document: fields.draft }
} })

export const publish = mutation({ args: { id: v.id('reports'), expectedVersion: v.number() }, handler: async (ctx, { id, expectedVersion }) => {
  const { report, user } = await requireAccess(ctx, id, 'owner')
  const state = await projectState(ctx, report)
  if (expectedVersion !== state.version) throw new ConvexError('The draft changed. Reload and review it before publishing.')
  const rendered = await renderReportProject(JSON.parse(state.data), state.document)
  if (!rendered.rows.length) throw new ConvexError('Choose at least one trial before publishing.')
  const document = JSON.stringify(state.document)
  if (state.stored?.publishedVersion === state.version) return state.version
  if (state.stored) await ctx.db.patch(state.stored._id, { published: document, publishedVersion: state.version })
  else await ctx.db.insert('reportProjects', { report: id, draft: document, version: 0, updatedBy: user.subject, published: document, publishedVersion: 0 })
  await ctx.db.insert('reportRevisions', { report: id, version: state.version, document, publishedBy: user.subject })
  return state.version
} })

const role = v.union(v.literal('editor'), v.literal('viewer'))
export const team = query({ args: { id: v.id('reports') }, handler: async (ctx, { id }) => {
  await requireAccess(ctx, id, 'owner')
  const members = await ctx.db.query('reportMembers').withIndex('by_report', q => q.eq('report', id)).take(20)
  const invites = await ctx.db.query('reportInvites').withIndex('by_report', q => q.eq('report', id)).order('desc').take(100)
  return { members: members.map(m => ({ id: m._id, label: m.label, role: m.role })), invites: invites.filter(i => !i.revoked && !i.usedBy && i.expiresAt > Date.now()).map(i => ({ id: i._id, token: i.token, role: i.role, expiresAt: i.expiresAt })) }
} })
export const invite = mutation({ args: { id: v.id('reports'), token: v.string(), role }, handler: async (ctx, { id, token, role }) => {
  await requireAccess(ctx, id, 'owner')
  if (!/^[a-f0-9]{64}$/.test(token)) throw new ConvexError('Invalid invitation token.')
  const invites = await ctx.db.query('reportInvites').withIndex('by_report', q => q.eq('report', id)).take(100)
  if (invites.length >= 100) throw new ConvexError('This report has reached its invitation limit.')
  if (await ctx.db.query('usedShareTokens').withIndex('by_token', q => q.eq('token', token)).first()) throw new ConvexError('Please retry creating the invitation.')
  await ctx.db.insert('usedShareTokens', { token })
  return ctx.db.insert('reportInvites', { report: id, token, role, expiresAt: Date.now() + 7 * 86400000, revoked: false })
} })
export const invitation = query({ args: { token: v.string() }, handler: async (ctx, { token }) => {
  const user = await identity(ctx)
  const invite = await ctx.db.query('reportInvites').withIndex('by_token', q => q.eq('token', token)).unique()
  if (!invite || invite.revoked || invite.expiresAt <= Date.now() || (invite.usedBy && invite.usedBy !== user.subject)) return null
  const report = await ctx.db.get(invite.report)
  return report ? { title: report.title, role: invite.role, report: report._id } : null
} })
export const accept = mutation({ args: { token: v.string() }, handler: async (ctx, { token }) => {
  const user = await identity(ctx)
  const invite = await ctx.db.query('reportInvites').withIndex('by_token', q => q.eq('token', token)).unique()
  if (!invite || invite.revoked || invite.expiresAt <= Date.now() || (invite.usedBy && invite.usedBy !== user.subject)) throw new ConvexError('This invitation is unavailable.')
  const report = await ctx.db.get(invite.report)
  if (!report) throw new ConvexError('Report not found.')
  if (report.owner === user.subject) throw new ConvexError('You already own this report. Send this invitation to your teammate.')
  const existing = await ctx.db.query('reportMembers').withIndex('by_report', q => q.eq('report', report._id).eq('user', user.subject)).unique()
  if (invite.usedBy) { if (!existing) throw new ConvexError('Your access was removed. Ask for a new invitation.'); return report._id }
  if ((await ctx.db.query('reportMembers').withIndex('by_report', q => q.eq('report', report._id)).take(20)).length >= 20) throw new ConvexError('This report has reached its 20-member limit.')
  if ((await ctx.db.query('reportMembers').withIndex('by_user', q => q.eq('user', user.subject)).take(100)).length >= 100) throw new ConvexError('You have reached the 100 joined-report limit.')
  if (existing) await ctx.db.patch(existing._id, { role: invite.role })
  else await ctx.db.insert('reportMembers', { report: report._id, user: user.subject, label: (user.email || user.name || user.subject).slice(0, 256), role: invite.role })
  await ctx.db.patch(invite._id, { usedBy: user.subject })
  return report._id
} })
export const removeMember = mutation({ args: { member: v.id('reportMembers') }, handler: async (ctx, { member }) => {
  const row = await ctx.db.get(member)
  if (!row) throw new ConvexError('Member not found.')
  await requireAccess(ctx, row.report, 'owner')
  await ctx.db.delete(member)
} })
export const revokeInvite = mutation({ args: { invite: v.id('reportInvites') }, handler: async (ctx, { invite }) => {
  const row = await ctx.db.get(invite)
  if (!row) throw new ConvexError('Invitation not found.')
  await requireAccess(ctx, row.report, 'owner')
  await ctx.db.patch(invite, { revoked: true })
} })
