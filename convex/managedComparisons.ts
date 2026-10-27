import { ConvexError, v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { identity } from './reportAccess'
import { managedSpecValidator } from './managedValidators'
import { profileValidator } from './runnerValidators'
import { parseManagedPolicy, validateManagedSpec } from '../src/runners/managedPolicy'
import { sameSettings } from '../src/runners/comparison'
import { terminalStates, validateProfiles } from '../src/runners/protocol'
import { createExperiment } from './experiments'
import { assertReportCapacity } from './reportCapacity'
import { materializeExperimentReport } from './experimentReports'

const terminal = ['completed', 'failed', 'cancelled']
function configuredPolicy() {
  if (process.env.HEVAL_MANAGED_ENABLED !== '1' || !/^[a-f0-9]{64}$/.test(process.env.HEVAL_MANAGED_CONTROL_TOKEN ?? '')) return null
  try { return parseManagedPolicy(process.env.HEVAL_MANAGED_POLICY_JSON ?? '') } catch { return null }
}
function operator(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token) || token !== process.env.HEVAL_MANAGED_CONTROL_TOKEN) throw new ConvexError('Managed worker authorization failed.')
}
function allowed(owner: string) { return (process.env.HEVAL_MANAGED_ALLOWED_USERS ?? '').split(',').map(s => s.trim()).filter(Boolean).includes(owner) }
async function owned(ctx: QueryCtx, id: Id<'managedComparisons'>) {
  const owner = (await identity(ctx)).subject, job = await ctx.db.get(id)
  if (!job || job.owner !== owner) throw new ConvexError('Comparison not found.')
  return job
}
async function leased(ctx: MutationCtx, id: Id<'managedComparisons'>, token: string, lease: string) {
  operator(token)
  const job = await ctx.db.get(id)
  if (!job || job.lease !== lease || job.leaseUntil < Date.now() || terminal.includes(job.status)) throw new ConvexError('Comparison lease expired.')
  return job
}
const controlArgs = { id: v.id('managedComparisons'), token: v.string(), lease: v.string() }
function publicJob(j: Doc<'managedComparisons'>) { return { id: j._id, title: j.title, spec: j.spec, status: j.status, message: j.message, experiment: j.experiment ?? null, baseline: j.baseline ?? null, createdAt: j._creationTime, deadline: j.deadline } }

export const catalog = query({ args: {}, handler: async ctx => {
  const owner = (await identity(ctx)).subject, p = configuredPolicy()
  const controller = await ctx.db.query('managedController').withIndex('by_name', q => q.eq('name', 'default')).unique()
  const permitted = allowed(owner), online = !!controller && Date.now() - controller.lastSeen < 90_000
  return { available: !!p && permitted && online, configured: !!p, permitted, online,
    policy: p ? { benchmark: p.benchmark, taskSet: p.taskSet, tasks: p.tasks, models: p.models, harnesses: p.harnesses, maxBudgetUsd: p.maxBudgetUsd, maxMinutes: p.maxMinutes } : null }
} })
export const list = query({ args: {}, handler: async ctx => {
  const owner = (await identity(ctx)).subject
  return (await ctx.db.query('managedComparisons').withIndex('by_owner', q => q.eq('owner', owner)).order('desc').take(50)).map(publicJob)
} })
export const get = query({ args: { id: v.id('managedComparisons') }, handler: async (ctx, { id }) => publicJob(await owned(ctx, id)) })

export const create = mutation({ args: { title: v.string(), requestId: v.string(), spec: managedSpecValidator, baseline: v.optional(v.id('comparisonBaselines')) }, handler: async (ctx, args) => {
  const owner = (await identity(ctx)).subject
  if (!args.title.trim() || args.title.length > 120 || !/^[a-f0-9]{64}$/.test(args.requestId)) throw new ConvexError('Enter a title and valid submission ID.')
  const selection = JSON.stringify({ title: args.title.trim(), spec: args.spec, baseline: args.baseline ?? null })
  const prior = await ctx.db.query('managedComparisons').withIndex('by_request', q => q.eq('owner', owner).eq('requestId', args.requestId)).unique()
  if (prior) { if (prior.selection !== selection) throw new ConvexError('This submission belongs to another comparison.'); return prior._id }
  const p = configuredPolicy()
  if (!p || !allowed(owner)) throw new ConvexError('Managed comparisons are available to invited beta accounts only.')
  const controller = await ctx.db.query('managedController').withIndex('by_name', q => q.eq('name', 'default')).unique()
  if (!controller || Date.now() - controller.lastSeen >= 90_000) throw new ConvexError('Managed workers are offline. Try again later or use your own worker.')
  try { validateManagedSpec(p, args.spec) } catch (e) { throw new ConvexError((e as Error).message) }
  const recent = await ctx.db.query('managedComparisons').withIndex('by_owner', q => q.eq('owner', owner)).order('desc').take(100)
  if (recent.some(j => !terminal.includes(j.status))) throw new ConvexError('Finish or cancel your active managed comparison first.')
  if (recent.filter(j => j._creationTime > Date.now() - 86400_000).length >= 10) throw new ConvexError('Your managed beta limit is ten comparisons per day.')
  if (recent.length >= 100) throw new ConvexError('Managed beta history is full. Contact the workspace administrator.')
  for (const status of ['queued', 'provisioning', 'running', 'stopping', 'cleanup'] as const) {
    if ((await ctx.db.query('managedComparisons').withIndex('by_status', q => q.eq('status', status)).take(20)).length >= 20) throw new ConvexError('The managed queue is full. Try again later.')
  }
  if (args.baseline) {
    const b = await ctx.db.get(args.baseline)
    if (!b || b.owner !== owner) throw new ConvexError('Baseline not found.')
    if (b.taskSet !== p.taskSet || b.attempts !== 1 || !sameSettings(b.runSettings, { concurrency: 1, retries: 0, timeoutSeconds: args.spec.minutes * 30 })) throw new ConvexError('Keep the baseline task snapshot, attempts and execution settings.')
  }
  await assertReportCapacity(ctx, owner, 4, 'Not enough report storage for this managed comparison.')
  return ctx.db.insert('managedComparisons', { owner, title: args.title.trim(), requestId: args.requestId, selection, spec: args.spec, snapshot: p.snapshot, taskSet: p.taskSet, tasks: p.tasks, status: 'queued', cancelRequested: false, message: 'Waiting for a managed worker', leaseUntil: 0, deadline: 0, ...(args.baseline ? { baseline: args.baseline } : {}) })
} })

async function stopRuns(ctx: MutationCtx, job: Doc<'managedComparisons'>) {
  if (!job.experiment) return
  const e = await ctx.db.get(job.experiment)
  const runs = await ctx.db.query('runnerRuns').withIndex('by_experiment', q => q.eq('experiment', job.experiment)).collect()
  const setup = e?.setupRun ? await ctx.db.get(e.setupRun) : null
  if (setup) runs.push(setup)
  for (const r of runs) {
    if (r.status === 'queued') await ctx.db.patch(r._id, { status: 'cancelled', phase: 'Cancelled before execution', finishedAt: Date.now() })
    if (r.status === 'running') await ctx.db.patch(r._id, { status: 'cancelling', phase: 'Stopping the managed worker' })
  }
  await materializeExperimentReport(ctx, job.experiment)
}
export const cancel = mutation({ args: { id: v.id('managedComparisons') }, handler: async (ctx, { id }) => {
  const job = await owned(ctx, id)
  if (terminal.includes(job.status)) return
  await stopRuns(ctx, job)
  await ctx.db.patch(id, { cancelRequested: true, stoppingAt: job.stoppingAt ?? Date.now(), status: job.status === 'queued' ? 'cancelled' : 'stopping', message: job.status === 'queued' ? 'Cancelled before provisioning' : 'Stopping execution and cleaning up resources' })
} })

/** One durable global slot. A restarted coordinator recovers the same named VM. */
export const claim = mutation({ args: { token: v.string(), lease: v.string() }, handler: async (ctx, { token, lease }) => {
  operator(token)
  if (!/^[a-f0-9]{64}$/.test(lease)) throw new ConvexError('Invalid coordinator identity.')
  const heartbeat = await ctx.db.query('managedController').withIndex('by_name', q => q.eq('name', 'default')).unique()
  if (heartbeat) await ctx.db.patch(heartbeat._id, { lastSeen: Date.now() })
  else await ctx.db.insert('managedController', { name: 'default', lastSeen: Date.now() })
  let job: Doc<'managedComparisons'> | null = null
  for (const status of ['cleanup', 'stopping', 'running', 'provisioning'] as const) {
    job = await ctx.db.query('managedComparisons').withIndex('by_status', q => q.eq('status', status)).first()
    if (job) break
  }
  if (job && job.lease !== lease && job.leaseUntil > Date.now()) return null
  if (!job) {
    if (!configuredPolicy()) return null
    job = await ctx.db.query('managedComparisons').withIndex('by_status', q => q.eq('status', 'queued')).first()
    if (!job) return null
    if (!allowed(job.owner) || Date.now() - job._creationTime > 30 * 60_000) { await ctx.db.patch(job._id, { status: 'cancelled', message: 'Queue access expired. Review and submit a new comparison.' }); return null }
    await ctx.db.patch(job._id, { status: 'provisioning', message: 'Preparing an isolated managed worker', deadline: Date.now() + (job.spec.minutes + 10) * 60_000 })
  }
  await ctx.db.patch(job._id, { lease, leaseUntil: Date.now() + 5 * 60_000 })
  return (await ctx.db.get(job._id))!
} })

export const renew = mutation({ args: controlArgs, handler: async (ctx, args) => {
  await leased(ctx, args.id, args.token, args.lease)
  await ctx.db.patch(args.id, { leaseUntil: Date.now() + 5 * 60_000 })
  const heartbeat = await ctx.db.query('managedController').withIndex('by_name', q => q.eq('name', 'default')).unique()
  if (heartbeat) await ctx.db.patch(heartbeat._id, { lastSeen: Date.now() })
} })

export const ready = mutation({ args: { ...controlArgs, credential: v.string(), profiles: v.array(profileValidator) }, handler: async (ctx, args) => {
  const job = await leased(ctx, args.id, args.token, args.lease)
  if (job.cancelRequested || job.deadline <= Date.now()) throw new ConvexError('Comparison cancelled or expired.')
  if (job.experiment && job.runner) return { experiment: job.experiment, runner: job.runner }
  if (job.status !== 'provisioning' || !/^[a-f0-9]{64}$/.test(args.credential)) throw new ConvexError('Worker not ready for activation.')
  try { validateProfiles(args.profiles) } catch { throw new ConvexError('Invalid managed worker profiles.') }
  const check = args.profiles.find(p => p.setupCheck && p.agent === 'oracle' && p.tasks === 1)
  const profiles = args.profiles.filter(p => !p.setupCheck)
  const expected = job.spec.harnesses.flatMap(agent => job.spec.models.map(model => `${agent}/${model}`))
  if (!check || args.profiles.length !== 3 || profiles.length !== 2 || profiles.some(p => p.taskSet !== job.taskSet || p.tasks !== job.tasks || p.attempts !== 1 || p.runSettingsVersion !== 1 || !expected.includes(`${p.agent}/${p.model}`)) || new Set(profiles.map(p => `${p.agent}/${p.model}`)).size !== 2) throw new ConvexError('Managed worker does not match the approved comparison.')
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(args.credential))), b => b.toString(16).padStart(2, '0')).join('')
  if (await ctx.db.query('runners').withIndex('by_credential', q => q.eq('credentialHash', hash)).first()) throw new ConvexError('Managed worker identity already used.')
  const runner = await ctx.db.insert('runners', { owner: job.owner, name: 'Managed comparison worker', managed: true, credentialHash: hash, revoked: false, lastSeen: Date.now(), ready: true, health: 'Managed worker prepared', profiles: args.profiles, leaseUntil: 0, machine: 'cloud' })
  // Exchange the pending report reservation for real runner/experiment reservations.
  await ctx.db.patch(job._id, { status: 'running', runner })
  const experiment = await createExperiment(ctx, job.owner, { runner, title: job.title, requestId: job.requestId, attempts: 1, goal: job.spec.goal, baseline: job.baseline, runSettings: { concurrency: 1, retries: 0, timeoutSeconds: job.spec.minutes * 30 }, profiles: profiles.map(p => ({ id: p.id, digest: p.digest })), checkWorker: true })
  await ctx.db.patch(job._id, { experiment, message: 'Running the free worker check before the model comparison' })
  return { experiment, runner }
} })

export const progress = mutation({ args: controlArgs, handler: async (ctx, args) => {
  const job = await leased(ctx, args.id, args.token, args.lease)
  const runs = job.experiment ? await ctx.db.query('runnerRuns').withIndex('by_experiment', q => q.eq('experiment', job.experiment)).collect() : []
  const experiment = job.experiment ? await ctx.db.get(job.experiment) : null
  const setup = experiment?.setupRun ? await ctx.db.get(experiment.setupRun) : null
  const allRuns = setup ? [...runs, setup] : runs
  const complete = !!runs.length && allRuns.every(r => (terminalStates as readonly string[]).includes(r.status))
  const expired = job.deadline <= Date.now()
  if (expired && !complete) { await stopRuns(ctx, job); await ctx.db.patch(job._id, { status: 'stopping', stoppingAt: job.stoppingAt ?? Date.now() }) }
  else if (!complete && !job.cancelRequested) {
    const message = setup && setup.status !== 'completed' ? `Worker check: ${setup.phase}` : `${runs.filter(r => (terminalStates as readonly string[]).includes(r.status)).length} of ${runs.length} model runs finished`
    if (job.message !== message) await ctx.db.patch(job._id, { message })
  }
  return { complete, cancel: job.cancelRequested, expired, failed: allRuns.some(r => r.status !== 'completed'), cleanupAfter: job.stoppingAt ? job.stoppingAt + 90_000 : expired ? Date.now() + 90_000 : undefined }
} })

/** A terminal job is accepted only after the coordinator confirms resource deletion. */
export const finish = mutation({ args: { ...controlArgs, outcome: v.union(v.literal('completed'), v.literal('failed'), v.literal('cancelled')) }, handler: async (ctx, args) => {
  const job = await leased(ctx, args.id, args.token, args.lease)
  if (job.status !== 'cleanup') throw new ConvexError('Complete resource cleanup before finishing this comparison.')
  let successful = false
  if (job.experiment) {
    const e = await ctx.db.get(job.experiment)
    const runs = await ctx.db.query('runnerRuns').withIndex('by_experiment', q => q.eq('experiment', job.experiment)).collect()
    const check = e?.setupRun ? await ctx.db.get(e.setupRun) : null
    if (check) runs.push(check)
    successful = runs.length > 0 && runs.every(r => r.status === 'completed')
    for (const r of runs) if (!(terminalStates as readonly string[]).includes(r.status)) await ctx.db.patch(r._id, { status: job.cancelRequested ? 'cancelled' : 'interrupted', finishedAt: Date.now(), phase: 'Managed worker removed', message: 'The worker stopped before a final report was uploaded. Recorded reports remain available.' })
    await materializeExperimentReport(ctx, job.experiment)
  }
  if (job.runner) await ctx.db.patch(job.runner, { revoked: true, ready: false })
  const status = job.cancelRequested ? 'cancelled' : args.outcome === 'completed' && !successful ? 'failed' : args.outcome
  await ctx.db.patch(job._id, { status, leaseUntil: 0, message: status === 'completed' ? 'Comparison finished; worker and temporary model key deleted' : status === 'cancelled' ? 'Comparison cancelled; worker and temporary model key deleted' : 'Comparison stopped; worker and temporary model key deleted. Available reports were preserved.' })
} })

export const cleanup = mutation({ args: { ...controlArgs, outcome: v.union(v.literal('completed'), v.literal('failed'), v.literal('cancelled')) }, handler: async (ctx, args) => {
  const job = await leased(ctx, args.id, args.token, args.lease)
  await ctx.db.patch(job._id, { status: 'cleanup', cleanupOutcome: args.outcome, message: 'Removing the worker and temporary model credentials' })
} })
