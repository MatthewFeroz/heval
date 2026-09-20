import { v, ConvexError } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { QueryCtx, MutationCtx } from './_generated/server'
import type { Id, Doc } from './_generated/dataModel'
import { identity } from './reportAccess'
import { profileValidator } from './runnerValidators'
import { RUNNER_LEASE_MS, RUNNER_ONLINE_MS, validateProfiles, terminalStates } from '../src/runners/protocol'
import { parseReport } from '../src/reports/format'

const secret = (value: string) => { if (!/^[a-f0-9]{64}$/.test(value)) throw new ConvexError('Invalid connection credential.'); return value }
async function digest(value: string) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret(value)))), b => b.toString(16).padStart(2, '0')).join('') }
async function ownerRunner(ctx: QueryCtx, id: Id<'runners'>) {
  const user = await identity(ctx), runner = await ctx.db.get(id)
  if (!runner || runner.owner !== user.subject) throw new ConvexError('Machine not found.')
  return runner
}
async function ownerRun(ctx: QueryCtx, id: Id<'runnerRuns'>) {
  const user = await identity(ctx), run = await ctx.db.get(id)
  if (!run || run.owner !== user.subject) throw new ConvexError('Evaluation not found.')
  return run
}
async function authenticateRunner(ctx: QueryCtx, credential: string) {
  const hash = await digest(credential)
  const runner = await ctx.db.query('runners').withIndex('by_credential', q => q.eq('credentialHash', hash)).unique()
  if (!runner || runner.revoked) throw new ConvexError('Machine credential revoked or invalid. Reconnect from Heval.')
  return runner
}
function checkSession(runner: Doc<'runners'>, session: string) {
  secret(session)
  if (runner.session !== session) throw new ConvexError('Another runner session owns this connection. Stop the other daemon before reconnecting.')
}
function publicRunner(r: Doc<'runners'>) { return { id: r._id, name: r.name, revoked: r.revoked, lastSeen: r.lastSeen, ready: r.ready, health: r.health, profiles: r.profiles, activeRun: r.activeRun ?? null } }
function publicRun(r: Doc<'runnerRuns'>) { return { id: r._id, runner: r.runner, profile: r.profile, experiment: r.experiment ?? null, requestedAttempts: r.requestedAttempts ?? r.profile.attempts, status: r.status, createdAt: r._creationTime, startedAt: r.startedAt ?? null, finishedAt: r.finishedAt ?? null, report: r.report ?? null, phase: r.phase, message: r.message ?? null } }

export const list = query({ args: {}, handler: async ctx => {
  const owner = (await identity(ctx)).subject
  return (await ctx.db.query('runners').withIndex('by_owner', q => q.eq('owner', owner)).take(20)).map(publicRunner)
} })
export const runs = query({ args: {}, handler: async ctx => {
  const owner = (await identity(ctx)).subject
  return (await ctx.db.query('runnerRuns').withIndex('by_owner', q => q.eq('owner', owner)).order('desc').take(200)).map(publicRun)
} })
export const createPairing = mutation({ args: { name: v.string(), code: v.string() }, handler: async (ctx, { name, code }) => {
  const owner = (await identity(ctx)).subject
  if (!name.trim() || name.length > 80) throw new ConvexError('Name this machine in 1–80 characters.')
  if ((await ctx.db.query('runners').withIndex('by_owner', q => q.eq('owner', owner)).take(20)).length >= 20) throw new ConvexError('This workspace has reached its 20-machine limit.')
  const codeHash = await digest(code)
  const existing = await ctx.db.query('runnerPairings').withIndex('by_hash', q => q.eq('codeHash', codeHash)).unique()
  if (existing) { if (existing.owner !== owner) throw new ConvexError('Create a fresh pairing code.'); return { expiresAt: existing.expiresAt } }
  const previous = await ctx.db.query('runnerPairings').withIndex('by_owner', q => q.eq('owner', owner)).take(30)
  for (const p of previous) if (p.expiresAt < Date.now()) await ctx.db.delete(p._id)
  if (previous.filter(p => p.expiresAt >= Date.now()).length >= 10) throw new ConvexError('Too many pending connections. Wait ten minutes before trying again.')
  const expiresAt = Date.now() + 600_000
  await ctx.db.insert('runnerPairings', { owner, name: name.trim(), codeHash, expiresAt })
  return { expiresAt }
} })
export const connect = mutation({ args: { code: v.string(), credential: v.string() }, handler: async (ctx, { code, credential }) => {
  const codeHash = await digest(code), credentialHash = await digest(credential)
  const pairing = await ctx.db.query('runnerPairings').withIndex('by_hash', q => q.eq('codeHash', codeHash)).unique()
  if (!pairing || pairing.expiresAt <= Date.now()) throw new ConvexError('This pairing code has expired or is invalid. Create a new code in Heval.')
  if (pairing.runner) {
    const runner = await ctx.db.get(pairing.runner)
    if (!runner || runner.revoked || runner.credentialHash !== credentialHash) throw new ConvexError('This pairing code was already used.')
    return { id: runner._id, name: runner.name }
  }
  if ((await ctx.db.query('runners').withIndex('by_owner', q => q.eq('owner', pairing.owner)).take(20)).length >= 20) throw new ConvexError('This workspace has reached its 20-machine limit.')
  if (await ctx.db.query('runners').withIndex('by_credential', q => q.eq('credentialHash', credentialHash)).first()) throw new ConvexError('Generate a fresh machine credential.')
  const id = await ctx.db.insert('runners', { owner: pairing.owner, name: pairing.name, credentialHash, revoked: false, ready: false, health: 'Waiting for runner checks', profiles: [], lastSeen: 0, leaseUntil: 0 })
  await ctx.db.patch(pairing._id, { runner: id })
  return { id, name: pairing.name }
} })
export const enqueue = mutation({ args: { runner: v.id('runners'), profileId: v.string(), digest: v.string(), requestId: v.string() }, handler: async (ctx, args) => {
  const machine = await ownerRunner(ctx, args.runner)
  secret(args.requestId)
  const existing = await ctx.db.query('runnerRuns').withIndex('by_request', q => q.eq('owner', machine.owner).eq('requestId', args.requestId)).unique()
  if (existing) {
    if (existing.runner !== args.runner || existing.profile.id !== args.profileId || existing.profile.digest !== args.digest) throw new ConvexError('This request already belongs to a different evaluation.')
    return existing._id
  }
  if (machine.revoked || !machine.ready || Date.now() - machine.lastSeen > RUNNER_ONLINE_MS) throw new ConvexError('Connect this machine and pass its setup checks before starting.')
  const profile = machine.profiles.find(p => p.id === args.profileId && p.digest === args.digest)
  if (!profile) throw new ConvexError('The machine’s evaluation profile changed. Review the latest profile before starting.')
  const history = await ctx.db.query('runnerRuns').withIndex('by_owner', q => q.eq('owner', machine.owner)).take(200)
  if (history.length >= 200) throw new ConvexError('This workspace has reached its 200-evaluation limit.')
  if (history.filter(r => r.status === 'queued' || r.status === 'running' || r.status === 'cancelling').length >= 10) throw new ConvexError('Keep at most ten queued or active evaluations.')
  if ((await ctx.db.query('reports').withIndex('by_owner', q => q.eq('owner', machine.owner)).take(100)).length >= 100) throw new ConvexError('Your report storage is full. Resolve it before running another evaluation.')
  return ctx.db.insert('runnerRuns', { owner: machine.owner, runner: args.runner, requestId: args.requestId, profile, status: 'queued', phase: 'Queued for this machine' })
} })
export const moveQueued = mutation({ args: { id: v.id('runnerRuns'), runner: v.id('runners') }, handler: async (ctx, { id, runner }) => {
  const run = await ownerRun(ctx, id), destination = await ownerRunner(ctx, runner)
  if (run.status !== 'queued') throw new ConvexError('Only queued evaluations can move. A running container stays on its original machine.')
  if (destination.revoked || !destination.ready || Date.now() - destination.lastSeen > RUNNER_ONLINE_MS || !destination.profiles.some(p => p.id === run.profile.id && p.digest === run.profile.digest)) throw new ConvexError('Choose a connected machine with the exact same approved profile.')
  await ctx.db.patch(id, { runner, phase: 'Queued for this machine' })
} })
export const cancel = mutation({ args: { id: v.id('runnerRuns') }, handler: async (ctx, { id }) => {
  const run = await ownerRun(ctx, id)
  if (run.status === 'queued') await ctx.db.patch(id, { status: 'cancelled', finishedAt: Date.now(), phase: 'Cancelled before execution' })
  else if (run.status === 'running') await ctx.db.patch(id, { status: 'cancelling', phase: 'Waiting for the machine to stop and clean up' })
} })
export const revoke = mutation({ args: { id: v.id('runners') }, handler: async (ctx, { id }) => {
  const runner = await ownerRunner(ctx, id)
  await ctx.db.patch(id, { revoked: true, ready: false, health: 'Connection revoked' })
  const queued = await ctx.db.query('runnerRuns').withIndex('by_runner_status', q => q.eq('runner', id).eq('status', 'queued')).take(10)
  for (const run of queued) await ctx.db.patch(run._id, { status: 'cancelled', phase: 'Machine connection revoked', finishedAt: Date.now() })
  if (runner.activeRun) await ctx.db.patch(runner.activeRun, { status: 'interrupted', phase: 'Connection revoked; check the physical machine', message: 'Remote access is revoked. Stop or inspect any remaining containers on the machine; revocation cannot guarantee physical shutdown.', finishedAt: Date.now() })
} })

/** Outbound polling is also the heartbeat. A durable claim is never reassigned on timeout. */
export const poll = mutation({ args: { credential: v.string(), session: v.string(), claimId: v.string(), profiles: v.array(profileValidator), ready: v.boolean(), health: v.string() }, handler: async (ctx, args) => {
  const runner = await authenticateRunner(ctx, args.credential)
  secret(args.session); secret(args.claimId)
  if (runner.session && runner.session !== args.session && runner.leaseUntil > Date.now()) throw new ConvexError('Another runner session owns this connection. Stop the other daemon before reconnecting.')
  try { validateProfiles(args.profiles) } catch (error) { throw new ConvexError((error as Error).message) }
  if (args.health.length > 160) throw new ConvexError('Invalid health summary.')
  await ctx.db.patch(runner._id, { session: args.session, leaseUntil: Date.now() + RUNNER_LEASE_MS, lastSeen: Date.now(), ready: args.ready, health: args.health, profiles: args.profiles })
  if (runner.activeRun) {
    const active = await ctx.db.get(runner.activeRun)
    if (active && (active.status === 'running' || active.status === 'cancelling')) return { id: active._id, profile: active.profile, requestedAttempts: active.requestedAttempts, claimId: active.claimId!, cancel: active.status === 'cancelling' }
    await ctx.db.patch(runner._id, { activeRun: undefined })
  }
  if (!args.ready) return null
  const next = await ctx.db.query('runnerRuns').withIndex('by_runner_status', q => q.eq('runner', runner._id).eq('status', 'queued')).first()
  if (!next) return null
  if (!args.profiles.some(p => p.id === next.profile.id && p.digest === next.profile.digest)) {
    await ctx.db.patch(next._id, { status: 'failed', phase: 'Approved profile changed before execution', finishedAt: Date.now() })
    return null
  }
  await ctx.db.patch(next._id, { status: 'running', claimId: args.claimId, startedAt: Date.now(), phase: 'Preparing Harbor on the connected machine' })
  await ctx.db.patch(runner._id, { activeRun: next._id })
  return { id: next._id, profile: next.profile, requestedAttempts: next.requestedAttempts, claimId: args.claimId, cancel: false }
} })
async function claimedRun(ctx: MutationCtx, args: { credential: string; session: string; id: Id<'runnerRuns'>; claimId: string }) {
  const runner = await authenticateRunner(ctx, args.credential)
  checkSession(runner, args.session)
  const run = await ctx.db.get(args.id)
  if (!run || run.runner !== runner._id || run.claimId !== args.claimId) throw new ConvexError('Evaluation claim does not belong to this machine.')
  return { runner, run }
}
const claimArgs = { credential: v.string(), session: v.string(), id: v.id('runnerRuns'), claimId: v.string() }
export const progress = mutation({ args: { ...claimArgs, phase: v.union(v.literal('Running Harbor'), v.literal('Stopping Harbor'), v.literal('Saving report'), v.literal('Recovering local execution')) }, handler: async (ctx, args) => {
  const { run } = await claimedRun(ctx, args)
  if (run.status === 'running') await ctx.db.patch(run._id, { phase: args.phase })
} })
export const finish = mutation({ args: { ...claimArgs, status: v.union(v.literal('completed'), v.literal('failed'), v.literal('cancelled'), v.literal('interrupted')), json: v.optional(v.string()), message: v.optional(v.string()) }, handler: async (ctx, args) => {
  const { runner, run } = await claimedRun(ctx, args)
  if ((terminalStates as readonly string[]).includes(run.status)) return { report: run.report ?? null }
  let report: Id<'reports'> | undefined
  const cancelled = run.status === 'cancelling' || args.status === 'cancelled'
  const status = cancelled ? 'cancelled' : args.status
  if (args.message && args.message.length > 300) throw new ConvexError('Use a short result summary, not raw logs.')
  if (args.json && !cancelled) {
    let data
    try { data = parseReport(args.json) } catch (e) { throw new ConvexError((e as Error).message) }
    if (data.rows.length > run.profile.tasks * (run.requestedAttempts ?? run.profile.attempts)) throw new ConvexError('The result exceeds the approved trial count.')
    if (status === 'completed' && data.rows.length !== run.profile.tasks * (run.requestedAttempts ?? run.profile.attempts)) throw new ConvexError('Completed evaluations must include every approved trial.')
    if ((await ctx.db.query('reports').withIndex('by_owner', q => q.eq('owner', run.owner)).take(100)).length >= 100) throw new ConvexError('Report storage is full. Results remain on the machine until storage is available.')
    report = await ctx.db.insert('reports', { owner: run.owner, title: run.profile.title.slice(0, 120), trials: data.rows.length, shareToken: null })
    await ctx.db.insert('reportData', { report, json: JSON.stringify(data) })
  }
  if (status === 'completed' && !report) throw new ConvexError('A completed evaluation must include its results.')
  await ctx.db.patch(run._id, { status, report, finishedAt: Date.now(), phase: status === 'completed' ? 'Report saved privately' : status === 'cancelled' ? 'Cancelled on the machine' : 'Execution needs attention', message: args.message })
  if (runner.activeRun === run._id) await ctx.db.patch(runner._id, { activeRun: undefined })
  return { report: report ?? null }
} })
