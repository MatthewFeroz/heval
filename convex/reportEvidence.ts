import { ConvexError, v } from 'convex/values'
import { mutation } from './_generated/server'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'
import { requireAccess } from './reportAccess'
import { parseStoredReport } from '../src/reports/format'
import { validateEvidence, type EvidenceKind } from '../src/reports/runArtifacts'
import { evidenceKindValidator } from './evidenceValidators'

const fields = { report: v.id('reports'), trial: v.string(), title: v.string(), kind: evidenceKindValidator, text: v.string() }
export type EvidenceEntry = { trial: string; title: string; kind: EvidenceKind; text: string }
type EvidenceInput = EvidenceEntry & { report: Id<'reports'> }
export const MAX_EVIDENCE_ITEMS = 200
const MAX_EVIDENCE_BYTES = 750_000
export async function reportEvidence(ctx: QueryCtx, report: Id<'reports'>, publicOnly = false) {
  const records = await ctx.db.query('reportEvidence').withIndex('by_report', q => q.eq('report', report)).take(MAX_EVIDENCE_ITEMS)
  return records.filter(r => !publicOnly || r.published).map(r => ({ id: r._id, trial: r.trial, title: r.title, kind: r.kind, text: r.text, hash: r.hash, published: r.published }))
}
export async function addEvidence(ctx: MutationCtx, input: EvidenceInput) {
  return (await addEvidenceBatch(ctx, input.report, [input]))[0]
}
/** Read the report and evidence once, including for bounded automatic captures. */
export async function addEvidenceBatch(ctx: MutationCtx, report: Id<'reports'>, entries: EvidenceEntry[]) {
  const stored = await ctx.db.query('reportData').withIndex('by_report', q => q.eq('report', report)).unique()
  if (!stored) throw new ConvexError('Evidence must identify an actual trial in this report.')
  const trials = new Set(parseStoredReport(stored.json).rows.map(row => row.trial))
  const existing = await ctx.db.query('reportEvidence').withIndex('by_report', q => q.eq('report', report)).take(MAX_EVIDENCE_ITEMS)
  const encoder = new TextEncoder(), keys: string[] = []
  let size = existing.reduce((sum, item) => sum + encoder.encode(item.text).length, 0), count = existing.length
  const known = new Map(existing.map(item => [`${item.trial}\0${item.kind}\0${item.hash}`, item._id]))
  const pending = new Map<string, EvidenceEntry & { hash: string }>()
  for (const input of entries) {
    if (!input.title.trim() || input.title.length > 120) throw new ConvexError('Use an evidence title up to 120 characters.')
    try { validateEvidence(input.kind, input.text) } catch (error) { throw new ConvexError((error as Error).message) }
    if (!trials.has(input.trial)) throw new ConvexError('Evidence must identify an actual trial in this report.')
    const bytes = encoder.encode(input.text), hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('')
    const key = `${input.trial}\0${input.kind}\0${hash}`
    keys.push(key)
    if (known.has(key) || pending.has(key)) continue
    if (++count > MAX_EVIDENCE_ITEMS || (size += bytes.length) > MAX_EVIDENCE_BYTES) throw new ConvexError('This report has reached its evidence storage limit.')
    pending.set(key, { trial: input.trial, kind: input.kind, text: input.text, title: input.title.trim(), hash })
  }
  for (const [key, input] of pending) known.set(key, await ctx.db.insert('reportEvidence', { report, ...input, published: false }))
  return keys.map(key => known.get(key)!)
}
export const add = mutation({ args: fields, handler: async (ctx, args) => {
  await requireAccess(ctx, args.report, 'owner')
  return addEvidence(ctx, args)
} })
export const setPublished = mutation({ args: { id: v.id('reportEvidence'), published: v.boolean(), reviewed: v.boolean() }, handler: async (ctx, args) => {
  const evidence = await ctx.db.get(args.id)
  if (!evidence) throw new ConvexError('Evidence unavailable.')
  await requireAccess(ctx, evidence.report, 'owner')
  if (args.published && !args.reviewed) throw new ConvexError('Review the complete evidence for private data before publishing it.')
  await ctx.db.patch(evidence._id, { published: args.published })
} })

/** Separate bounded artifact path; the normalized metrics importer stays unchanged. */
export const captureManaged = mutation({ args: { job: v.id('managedComparisons'), token: v.string(), entries: v.array(v.object(fields)) }, handler: async (ctx, args) => {
  if (!/^[a-f0-9]{64}$/.test(args.token) || args.token !== process.env.HEVAL_MANAGED_CONTROL_TOKEN) throw new ConvexError('Managed worker authorization failed.')
  const job = await ctx.db.get(args.job)
  if (!job?.experiment || !['running', 'stopping', 'cleanup'].includes(job.status) || args.entries.length > 12) throw new ConvexError('Managed evidence unavailable.')
  const runs = await ctx.db.query('runnerRuns').withIndex('by_experiment', q => q.eq('experiment', job.experiment)).collect()
  const experiment = await ctx.db.get(job.experiment)
  for (const entry of args.entries) {
    const run = runs.find(r => r.report === entry.report)
    if (!run || run.owner !== job.owner) throw new ConvexError('Evidence does not belong to this comparison.')
    await addEvidence(ctx, entry)
    if (experiment?.report) {
      const stored = await ctx.db.query('reportData').withIndex('by_report', q => q.eq('report', entry.report)).unique()
      const index = parseStoredReport(stored!.json).rows.findIndex(row => row.trial === entry.trial)
      await addEvidence(ctx, { ...entry, report: experiment.report, trial: `${run.profile.id}:${index + 1}:${entry.trial}`.slice(0, 256) })
    }
  }
} })
