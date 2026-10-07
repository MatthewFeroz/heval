/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { expect, test, vi } from 'vitest'
import schema from './schema'
import { materializeExperimentReport } from './experimentReports'
import { MAX_IMPORT_BYTES, parseReport, type ReportData } from '../src/reports/format'
import fixture from '../tests/fixtures/report-sharing.json'
import type { RunnerProfile } from '../src/runners/protocol'
import { api, internal } from './_generated/api'
import { get as getExperiment } from './experiments'
import { backfillResultSummaries, finish as finishRun } from './runners'
import { summarizeRun } from './runResults'
import type { FunctionArgs, FunctionReference, FunctionReturnType } from 'convex/server'
import type { MutationCtx } from './_generated/server'

const modules = import.meta.glob(['./**/*.ts', './**/*.js', '!./**/*.test.ts'])
const key = (n: number) => n.toString(16).padStart(64, '0')
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length
const profile: RunnerProfile = { id: 'model-check', digest: key(1), title: 'SYNTHETIC check', benchmark: 'Synthetic fixture', agent: 'codex', model: 'synthetic/model', vendor: 'synthetic', taskSet: key(2), maxAttempts: 1, tasks: 1000, attempts: 1, timeoutSeconds: 300, setupCheck: false }
const title = 'SYNTHETIC large experiment'
const generatedAt = '2100-01-01T00:00:00.000Z'
const large = parseReport(JSON.stringify({ ...fixture, generatedAt, rows: Array.from({ length: 1000 }, (_, i) => ({ ...fixture.rows[0], trial: `trial-${i}` })) }))

// Observe database reads while invoking the registered function's real handler.
function handler<F extends FunctionReference<'query' | 'mutation', 'public' | 'internal'>>(registered: unknown) {
  return (registered as { _handler: (ctx: MutationCtx, args: FunctionArgs<F>) => Promise<FunctionReturnType<F>> })._handler
}

async function seed(reports: ReportData[], cacheResults = false) {
  const t = convexTest(schema, modules)
  const id = await t.run(async ctx => {
    const runner = await ctx.db.insert('runners', { owner: 'owner', name: 'Synthetic worker', credentialHash: key(10), revoked: false, ready: true, health: 'Synthetic ready', profiles: [], lastSeen: Date.now(), leaseUntil: 0 })
    const experiment = await ctx.db.insert('experiments', { owner: 'owner', title, runner, requestId: key(20), selection: 'Synthetic selection', attempts: 1, taskSet: key(2) })
    for (const [i, data] of reports.entries()) {
      const report = await ctx.db.insert('reports', { owner: 'owner', title: `Synthetic run ${i}`, trials: data.rows.length, shareToken: null })
      await ctx.db.insert('reportData', { report, json: JSON.stringify(data) })
      await ctx.db.insert('runnerRuns', { owner: 'owner', runner, experiment, requestId: key(100 + i), profile: { ...profile, id: `model-${i}` }, status: 'completed', phase: 'Report saved privately', report, ...(cacheResults ? { resultSummary: summarizeRun(data.rows) } : {}) })
    }
    return experiment
  })
  return { t, id }
}

test('oversized combinations stop reading reports after the byte budget is exceeded', async () => {
  expect(bytes(large)).toBeLessThan(MAX_IMPORT_BYTES)
  expect(bytes(large) * 40).toBeGreaterThan(16 * 1024 * 1024)
  const { t, id } = await seed(Array.from({ length: 40 }, () => large))
  await t.run(async ctx => {
    const reads = vi.spyOn(ctx.db, 'query')
    try {
      expect(await materializeExperimentReport(ctx, id)).toBeNull()
      expect(reads.mock.calls.filter(([table]) => table === 'reportData')).toHaveLength(2)
    } finally { reads.mockRestore() }
    expect((await ctx.db.query('runnerRuns').collect()).every(run => run.status === 'completed' && run.report)).toBe(true)
    expect(await ctx.db.query('reports').collect()).toHaveLength(40)
  })
})

function boundaryReport() {
  const data = structuredClone(large)
  data.rows.forEach(row => { row.taskFull = '測試🧪' })
  data.rows[0].trial = '🧪'.repeat(128)
  const transformed = () => ({ schemaVersion: 1, job: title, generatedAt, rows: data.rows.map((row, i) => ({ ...row, trial: `model-0:${i + 1}:${row.trial}`.slice(0, 256) })) })
  let remaining = MAX_IMPORT_BYTES - bytes(transformed())
  for (const row of data.rows) {
    const padding = Math.min(remaining, 256 - row.taskFull.length)
    row.taskFull += 'x'.repeat(padding)
    remaining -= padding
    if (!remaining) break
  }
  expect(remaining).toBe(0)
  expect(bytes(transformed())).toBe(MAX_IMPORT_BYTES)
  expect(bytes(data)).toBeLessThan(MAX_IMPORT_BYTES)
  return { data, expected: parseReport(JSON.stringify(transformed())) }
}

test('combined reports accept the exact UTF-8 byte boundary, preserving Unicode and truncated trial IDs', async () => {
  const { data, expected } = boundaryReport()
  const { t, id } = await seed([data])
  await t.run(async ctx => {
    const report = await materializeExperimentReport(ctx, id)
    expect(report).toBeTruthy()
    const stored = await ctx.db.query('reportData').withIndex('by_report', q => q.eq('report', report!)).unique()
    expect(parseReport(stored!.json)).toEqual(expected)
    expect(new TextEncoder().encode(stored!.json)).toHaveLength(MAX_IMPORT_BYTES)
  })
})

test('combined reports reject one UTF-8 byte beyond the limit without changing individual results', async () => {
  const data = boundaryReport().data
  const row = data.rows.find(row => row.taskFull.length < 256)!
  row.taskFull += 'x'
  const { t, id } = await seed([data])
  await t.run(async ctx => {
    expect(await materializeExperimentReport(ctx, id)).toBeNull()
    expect(await ctx.db.query('reports').collect()).toHaveLength(1)
  })
})

test('combined reports keep source order, unique prefixed IDs and the latest generation time', async () => {
  const first = { ...large, rows: large.rows.slice(0, 2) }
  const second = { ...large, generatedAt: '2101-01-01T00:00:00.000Z', rows: large.rows.slice(0, 1) }
  const { t, id } = await seed([first, second])
  await t.run(async ctx => {
    const report = await materializeExperimentReport(ctx, id)
    const stored = await ctx.db.query('reportData').withIndex('by_report', q => q.eq('report', report!)).unique()
    expect(parseReport(stored!.json)).toEqual({ schemaVersion: 1, job: title, generatedAt: second.generatedAt, rows: [
      { ...first.rows[0], trial: `model-0:1:${first.rows[0].trial}` },
      { ...first.rows[1], trial: `model-0:2:${first.rows[1].trial}` },
      { ...second.rows[0], trial: `model-1:1:${second.rows[0].trial}` },
    ] })
  })
})

async function connected(profiles: RunnerProfile[]) {
  const t = convexTest(schema, modules), owner = t.withIdentity({ subject: 'owner' })
  await owner.mutation(api.runners.createPairing, { name: 'Synthetic worker', code: key(10) })
  const credential = key(11), session = key(12), claimId = key(13)
  const { id: runner } = await t.mutation(api.runners.connect, { code: key(10), credential })
  const poll = () => t.mutation(api.runners.poll, { credential, session, claimId, profiles, ready: true, health: 'Synthetic ready' })
  await poll()
  const id = await owner.mutation(api.experiments.create, { runner, title, requestId: key(20), attempts: 1, profiles: profiles.map(p => ({ id: p.id, digest: p.digest })) })
  return { t, owner, runner, id, poll, credential, session, claimId }
}

test('the final large result finishes durably after forty individually valid reports', async () => {
  const profiles = Array.from({ length: 40 }, (_, i) => ({ ...profile, id: `model-${i}`, model: `synthetic/model-${i}` }))
  const { t, owner, runner, id, poll, credential, session, claimId } = await connected(profiles)
  await t.run(async ctx => {
    const runs = await ctx.db.query('runnerRuns').withIndex('by_experiment', q => q.eq('experiment', id)).collect()
    for (const run of runs.slice(0, 39)) {
      const report = await ctx.db.insert('reports', { owner: 'owner', title: run.profile.title, trials: large.rows.length, shareToken: null })
      await ctx.db.insert('reportData', { report, json: JSON.stringify(large) })
      await ctx.db.patch(run._id, { status: 'completed', report, resultSummary: summarizeRun(large.rows) })
    }
  })
  const run = (await poll())!
  await t.run(async ctx => {
    const reads = vi.spyOn(ctx.db, 'query')
    try {
      const saved = await handler<typeof api.runners.finish>(finishRun)(ctx, { credential, session, claimId, id: run.id, status: 'completed', json: JSON.stringify(large) })
      expect(saved.report).toBeTruthy()
      expect(reads.mock.calls.filter(([table]) => table === 'reportData')).toHaveLength(2)
    } finally { reads.mockRestore() }
    expect((await ctx.db.get(run.id))?.resultSummary?.trials).toBe(1000)
    expect((await ctx.db.get(runner))?.activeRun).toBeUndefined()
    expect(await ctx.db.query('reports').collect()).toHaveLength(40)
  })
  const experiment = await owner.query(api.experiments.get, { id })
  expect(experiment.report).toBeNull()
  expect(experiment.cells.every(cell => cell.status === 'completed' && cell.report && cell.result?.trials === 1000)).toBe(true)
  expect(await poll()).toBeNull()
})

test('cached partial summaries preserve metrics without full report reads on heartbeat updates', async () => {
  const { t, owner, runner, id, poll, credential, session, claimId } = await connected([{ ...profile, tasks: 4 }])
  const run = (await poll())!
  await owner.mutation(api.experiments.cancel, { id })
  const json = JSON.stringify({ ...fixture, rows: [
    { ...fixture.rows[0], trial: 'passed', passed: 1, reward: 1, agentSeconds: 10, inputTokens: 100, outputTokens: 2, costUsd: 0, agentVersion: 'v1' },
    { ...fixture.rows[0], trial: 'failed', passed: 0, reward: 0, agentSeconds: 20, inputTokens: null, outputTokens: 3, costUsd: null, agentVersion: 'v2' },
  ] })
  await t.mutation(api.runners.finish, { credential, session, claimId, id: run.id, status: 'cancelled', json })
  const expected = { trials: 2, passed: 1, medianSeconds: 10, inputTokens: null, outputTokens: 5, reportedCost: null, versions: ['v1', 'v2'], additionalVersions: 0 }
  for (const lastSeen of [Date.now(), Date.now() + 5000]) {
    await t.run(ctx => ctx.db.patch(runner, { lastSeen }))
    await owner.run(async ctx => {
      const reads = vi.spyOn(ctx.db, 'query')
      try {
        expect((await handler<typeof api.experiments.get>(getExperiment)(ctx, { id })).cells[0].result).toEqual(expected)
        expect(reads.mock.calls.filter(([table]) => table === 'reportData')).toHaveLength(0)
      } finally { reads.mockRestore() }
    })
  }
})

test('eighty version-heavy reports keep run scans bounded while preserving every source version', async () => {
  const data = parseReport(JSON.stringify({ ...fixture, generatedAt, rows: Array.from({ length: 889 }, (_, i) => ({ ...fixture.rows[0], trial: `trial-${i}`, agentVersion: `${i}`.padEnd(256, 'v') })) }))
  expect(bytes(data)).toBeLessThan(MAX_IMPORT_BYTES)
  expect(bytes(data) * 80).toBeGreaterThan(16 * 1024 * 1024)
  const { t, id } = await seed(Array.from({ length: 80 }, () => data), true)
  const owner = t.withIdentity({ subject: 'owner' })
  const runs = await t.run(ctx => ctx.db.query('runnerRuns').collect())
  // These complete documents are what status lists and capacity checks read.
  expect(bytes(runs)).toBeLessThan(1_000_000)
  expect(runs.every(run => run.resultSummary?.versions.length === 16 && run.resultSummary.additionalVersions === 873)).toBe(true)
  expect(await owner.query(api.runners.runs)).toHaveLength(80)
  expect((await owner.query(api.experiments.list))[0]).toMatchObject({ runs: 80, finished: 80 })
  await owner.run(async ctx => {
    const reads = vi.spyOn(ctx.db, 'query')
    try {
      const experiment = await handler<typeof api.experiments.get>(getExperiment)(ctx, { id })
      expect(experiment.cells.every(cell => cell.result?.trials === 889 && cell.result.additionalVersions === 873)).toBe(true)
      expect(reads.mock.calls.filter(([table]) => table === 'reportData')).toHaveLength(0)
      expect(await materializeExperimentReport(ctx, id)).toBeNull()
      expect(reads.mock.calls.filter(([table]) => table === 'reportData').length).toBeLessThanOrEqual(2)
    } finally { reads.mockRestore() }
    const stored = await ctx.db.query('reportData').withIndex('by_report', q => q.eq('report', runs[0].report!)).unique()
    expect(stored!.json).toBe(JSON.stringify(data))
    expect(new Set(parseReport(stored!.json).rows.map(row => row.agentVersion)).size).toBe(889)
  })
})

test('legacy metric fallback and backfilled summaries agree without changing report data', async () => {
  const data = parseReport(JSON.stringify({ ...fixture, rows: [{ ...fixture.rows[0], inputTokens: null, costUsd: null, passed: 1, reward: 1, agentSeconds: 3 }] }))
  const { t, id } = await seed([data]), owner = t.withIdentity({ subject: 'owner' })
  const before = (await owner.query(api.experiments.get, { id })).cells[0].result
  const migrated = await t.mutation(internal.runners.backfillResultSummaries, { cursor: null })
  expect(migrated).toMatchObject({ done: true, scanned: 1, updated: 1, unavailable: [] })
  expect((await owner.query(api.experiments.get, { id })).cells[0].result).toEqual(before)
  expect(before).toMatchObject({ trials: 1, passed: 1, medianSeconds: 3, inputTokens: null, reportedCost: null })
  expect(await t.run(async ctx => (await ctx.db.query('reportData').collect())[0].json)).toBe(JSON.stringify(data))
})

test('the summary backfill bounds each page, resumes safely, and reports unavailable source records', async () => {
  const { t } = await seed(Array.from({ length: 12 }, () => large))
  const runs = await t.run(async ctx => {
    const runs = await ctx.db.query('runnerRuns').collect()
    await ctx.db.patch(runs[0]._id, { resultSummary: summarizeRun(large.rows) })
    await ctx.db.patch(runs[1]._id, { report: undefined, status: 'cancelled' })
    const invalid = await ctx.db.query('reportData').withIndex('by_report', q => q.eq('report', runs[10].report!)).unique()
    await ctx.db.patch(invalid!._id, { json: '{invalid' })
    const missing = await ctx.db.query('reportData').withIndex('by_report', q => q.eq('report', runs[11].report!)).unique()
    await ctx.db.delete(missing!._id)
    return runs
  })
  const first = await t.run(async ctx => {
    const reads = vi.spyOn(ctx.db, 'query')
    try {
      const result = await handler<typeof internal.runners.backfillResultSummaries>(backfillResultSummaries)(ctx, { cursor: null })
      expect(reads.mock.calls.filter(([table]) => table === 'reportData')).toHaveLength(8)
      return result
    } finally { reads.mockRestore() }
  })
  expect(first).toMatchObject({ done: false, scanned: 10, updated: 8, unavailable: [] })
  expect(first.cursor).not.toBeNull()
  expect(await t.mutation(internal.runners.backfillResultSummaries, { cursor: null })).toMatchObject({ done: false, scanned: 10, updated: 0, unavailable: [] })
  expect(await t.mutation(internal.runners.backfillResultSummaries, { cursor: first.cursor })).toEqual({ cursor: null, done: true, scanned: 2, updated: 0, unavailable: [
    { run: runs[10]._id, reason: 'invalid' }, { run: runs[11]._id, reason: 'missing' },
  ] })
})


test('valid sparse uploads can finish and backfill after normalization exceeds the upload cap', async () => {
  const required = ['trial', 'reward', 'passed', 'timedOut', 'overSlow', 'task', 'taskFull', 'agent', 'model', 'modelShort', 'stack']
  const sparse = Object.fromEntries(required.map(key => [key, fixture.rows[0][key as keyof typeof fixture.rows[0]]]))
  const raw = JSON.stringify({ schemaVersion: 1, job: title, generatedAt, rows: Array.from({ length: 1200 }, (_, i) => ({ ...sparse, trial: `trial-${i}`, task: 't'.repeat(180), taskFull: 't'.repeat(180) })) })
  const data = parseReport(raw)
  expect(new TextEncoder().encode(raw).length).toBeLessThan(MAX_IMPORT_BYTES)
  expect(bytes(data)).toBeGreaterThan(MAX_IMPORT_BYTES)
  expect(bytes(data)).toBeLessThan(1024 * 1024)
  expect(() => parseReport(JSON.stringify(data))).toThrow('750 KB')
  const { t, owner, id, poll, credential, session, claimId } = await connected([{ ...profile, tasks: 1200 }])
  const run = (await poll())!
  const saved = await t.mutation(api.runners.finish, { credential, session, claimId, id: run.id, status: 'completed', json: raw })
  expect(saved.report).toBeTruthy()
  expect((await owner.query(api.experiments.get, { id })).cells[0].result).toEqual(summarizeRun(data.rows))
  expect((await owner.query(api.experiments.get, { id })).report).toBeNull()
  await t.run(ctx => ctx.db.patch(run.id, { resultSummary: undefined }))
  expect(await t.mutation(internal.runners.backfillResultSummaries, { cursor: null })).toMatchObject({ done: true, scanned: 1, updated: 1, unavailable: [] })
  expect((await owner.query(api.experiments.get, { id })).cells[0].result).toEqual(summarizeRun(data.rows))
  expect(await t.run(async ctx => (await ctx.db.query('reportData').withIndex('by_report', q => q.eq('report', saved.report!)).unique())!.json)).toBe(JSON.stringify(data))
})
