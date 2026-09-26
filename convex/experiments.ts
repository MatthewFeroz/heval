import { v, ConvexError } from 'convex/values'
import { mutation, query } from './_generated/server'
import { identity } from './reportAccess'
import { RUNNER_ONLINE_MS, terminalStates } from '../src/runners/protocol'
import { runSettingsValidator } from './runnerValidators'
import { executionTimeoutSeconds } from '../src/runners/protocol'
import { materializeExperimentReport } from './experimentReports'

export const create = mutation({ args: {
  runner: v.id('runners'), title: v.string(), requestId: v.string(), attempts: v.number(), runSettings: v.optional(runSettingsValidator),
  profiles: v.array(v.object({ id: v.string(), digest: v.string() })),
  checkWorker: v.optional(v.boolean()),
}, handler: async (ctx, args) => {
  const owner = (await identity(ctx)).subject
  if (!args.title.trim() || args.title.length > 120 || !/^[a-f0-9]{64}$/.test(args.requestId)) throw new ConvexError('Enter a title and a valid submission ID.')
  if (!args.profiles.length || new Set(args.profiles.map(p => p.id)).size !== args.profiles.length) throw new ConvexError('Choose one or more distinct combinations.')
  const selection = JSON.stringify({ runner: args.runner, title: args.title.trim(), attempts: args.attempts, ...(args.runSettings ? { runSettings: args.runSettings } : {}), ...(args.checkWorker ? { checkWorker: true } : {}), profiles: [...args.profiles].sort((a,b) => a.id.localeCompare(b.id)) })
  const prior = await ctx.db.query('experiments').withIndex('by_request', q => q.eq('owner', owner).eq('requestId', args.requestId)).unique()
  if (prior) {
    if (prior.selection !== selection) throw new ConvexError('This submission already belongs to another experiment.')
    return prior._id
  }
  const machine = await ctx.db.get(args.runner)
  if (!machine || machine.owner !== owner) throw new ConvexError('Machine not found.')
  if (machine.revoked || !machine.ready || Date.now() - machine.lastSeen > RUNNER_ONLINE_MS) throw new ConvexError('The worker must be online and ready before starting.')
  if (machine.enabled === false) throw new ConvexError(`${machine.name} is switched off. Switch it on in Runner setup before starting.`)
  const profiles = args.profiles.map(choice => {
    const p = machine.profiles.find(p => p.id === choice.id && p.digest === choice.digest)
    if (!p?.taskSet || !p.vendor || p.maxAttempts === undefined) throw new ConvexError('Worker options changed or need an update. Review your selections again.')
    if (!Number.isSafeInteger(args.attempts) || args.attempts < 1 || args.attempts > p.maxAttempts) throw new ConvexError('Attempts exceed the worker’s approved limit.')
    executionTimeoutSeconds(p, args.attempts, args.runSettings)
    return p
  })
  if (new Set(profiles.map(p => p.taskSet)).size !== 1) throw new ConvexError('Use the same task set for every combination.')
  for (const model of new Set(profiles.map(p => p.model))) {
    if (new Set(profiles.filter(p => p.model === model).map(p => p.vendor)).size !== 1) throw new ConvexError('Use the same vendor across harnesses for each model.')
  }
  if (new Set(profiles.map(p => `${p.agent}/${p.model}/${p.vendor}`)).size !== profiles.length) throw new ConvexError('Each harness and model combination must be unique.')
  if (!Number.isSafeInteger(profiles.reduce((sum,p) => sum + p.tasks * args.attempts, 0))) throw new ConvexError('Trial count exceeds safe numeric precision.')
  const history = await ctx.db.query('runnerRuns').withIndex('by_owner', q => q.eq('owner', owner)).take(200)
  const check = args.checkWorker ? machine.profiles.find(p => p.setupCheck && p.agent === 'oracle') : undefined
  if (args.checkWorker && !check) throw new ConvexError('Reopen setup on this computer to install its worker check.')
  const requiredRuns = profiles.length + (check ? 1 : 0)
  const pending = history.filter(r => !terminalStates.includes(r.status as typeof terminalStates[number])).length
  if (history.length + requiredRuns > 200) throw new ConvexError('Not enough run storage. Keep at most 200 total runs.')
  const reports = await ctx.db.query('reports').withIndex('by_owner', q => q.eq('owner', owner)).take(100)
  if (reports.length + pending + requiredRuns + 1 > 100) throw new ConvexError('Not enough report storage for this experiment.')
  // Persist the prerequisite with the experiment. It continues without a browser
  // and the worker cannot claim model work until the free check has passed.
  const setupRun = check ? await ctx.db.insert('runnerRuns', { owner, runner: args.runner, requestId: `${args.requestId}:setup`, profile: check, status: 'queued', phase: 'Checking this computer before the first evaluation' }) : undefined
  const id = await ctx.db.insert('experiments', { owner, title: args.title.trim(), runner: args.runner, requestId: args.requestId, selection, attempts: args.attempts, taskSet: profiles[0].taskSet!, ...(setupRun ? { setupRun } : {}) })
  for (const p of profiles) await ctx.db.insert('runnerRuns', { owner, runner: args.runner, experiment: id, requestedAttempts: args.attempts, ...(args.runSettings ? { runSettings: args.runSettings } : {}), requestId: `${args.requestId}:${p.id}`, profile: p, status: 'queued', phase: 'Queued for this machine' })
  return id
} })

export const list = query({ args: {}, handler: async ctx => {
  const owner = (await identity(ctx)).subject
  const experiments = await ctx.db.query('experiments').withIndex('by_owner', q => q.eq('owner', owner)).order('desc').take(200)
  return Promise.all(experiments.map(async e => {
    const runs = await ctx.db.query('runnerRuns').withIndex('by_experiment', q => q.eq('experiment', e._id)).collect()
    return { id: e._id, title: e.title, createdAt: e._creationTime, report: e.report ?? null, setupRun: e.setupRun ?? null, runs: runs.length, finished: runs.filter(r => terminalStates.includes(r.status as typeof terminalStates[number])).length, failed: runs.filter(r => r.status === 'failed' || r.status === 'interrupted').length }
  }))
} })

export const get = query({ args: { id: v.id('experiments') }, handler: async (ctx, { id }) => {
  const owner = (await identity(ctx)).subject, e = await ctx.db.get(id)
  if (!e || e.owner !== owner) throw new ConvexError('Experiment not found.')
  const machine = await ctx.db.get(e.runner)
  const setup = e.setupRun ? await ctx.db.get(e.setupRun) : null
  const runs = await ctx.db.query('runnerRuns').withIndex('by_experiment', q => q.eq('experiment', id)).collect()
  const cells = await Promise.all(runs.map(async r => {
    const data = r.report ? await ctx.db.query('reportData').withIndex('by_report', q => q.eq('report', r.report!)).unique() : null
    const rows = data ? (JSON.parse(data.json) as { rows: { passed: number; agentSeconds: number | null; costUsd: number | null; inputTokens: number | null; outputTokens: number | null; agentVersion?: string }[] }).rows : []
    const times = rows.flatMap(row => row.passed === 1 && typeof row.agentSeconds === 'number' ? [row.agentSeconds] : []).sort((a,b) => a-b)
    const mid = Math.floor(times.length/2)
    return { id: r._id, profile: r.profile, attempts: r.requestedAttempts ?? r.profile.attempts, runSettings: r.runSettings ?? null, status: r.status, phase: r.phase, message: r.message ?? null, report: r.report ?? null,
      result: data ? {
        inputTokens: rows.length && rows.every(row => typeof row.inputTokens === 'number') ? rows.reduce((n,row) => n + row.inputTokens!,0) : null,
        outputTokens: rows.length && rows.every(row => typeof row.outputTokens === 'number') ? rows.reduce((n,row) => n + row.outputTokens!,0) : null,
        versions: [...new Set(rows.flatMap(row => row.agentVersion ? [row.agentVersion] : []))],
        trials: rows.length, passed: rows.filter(row => row.passed === 1).length, medianSeconds: times.length ? times.length % 2 ? times[mid] : (times[mid-1]+times[mid])/2 : null,
        reportedCost: rows.length && rows.every(row => typeof row.costUsd === 'number') ? rows.reduce((n,row) => n + row.costUsd!,0) : null } : null }
  }))
  return { id, title: e.title, createdAt: e._creationTime, report: e.report ?? null, setup: setup ? { status: setup.status, phase: setup.phase, message: setup.message ?? null, report: setup.report ?? null } : null, machine: machine?.name ?? 'Disconnected worker', lastSeen: machine?.lastSeen ?? 0, online: !!machine && !machine.revoked && Date.now()-machine.lastSeen < RUNNER_ONLINE_MS, cells }
} })

export const cancel = mutation({ args: { id: v.id('experiments') }, handler: async (ctx, { id }) => {
  const owner = (await identity(ctx)).subject, e = await ctx.db.get(id)
  if (!e || e.owner !== owner) throw new ConvexError('Experiment not found.')
  const runs = await ctx.db.query('runnerRuns').withIndex('by_experiment', q => q.eq('experiment', id)).collect()
  const setup = e.setupRun ? await ctx.db.get(e.setupRun) : null
  if (setup) runs.push(setup)
  for (const r of runs) {
    if (r.status === 'queued') await ctx.db.patch(r._id, { status: 'cancelled', phase: 'Cancelled before execution', finishedAt: Date.now() })
    if (r.status === 'running') await ctx.db.patch(r._id, { status: 'cancelling', phase: 'Waiting for the machine to stop and clean up' })
  }
  await materializeExperimentReport(ctx, id)
} })
