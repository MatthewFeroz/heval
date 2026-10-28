/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { expect, test } from 'vitest'
import schema from './schema'
import { api } from './_generated/api'
import fixture from '../tests/fixtures/report-sharing.json'
import { storedReportCount } from './reportCapacity'
const modules = import.meta.glob(['./**/*.ts', './**/*.js', '!./**/*.test.ts'])
const profile = { id: 'demo', digest: '1'.repeat(64), title: 'Synthetic test', benchmark: 'Synthetic', agent: 'oracle', model: 'reference', tasks: 1, attempts: 1, timeoutSeconds: 300, setupCheck: true }
async function setup() {
  const t = convexTest(schema, modules), owner = t.withIdentity({ subject: 'owner' })
  const id = await owner.mutation(api.reports.save, { json: JSON.stringify(fixture), title: 'Synthetic deletion check' })
  const references = await t.run(async ctx => {
    const runner = await ctx.db.insert('runners', { owner: 'owner', name: 'Synthetic', credentialHash: 'test', revoked: false, lastSeen: 0, ready: true, health: 'Ready', profiles: [profile], leaseUntil: 0 })
    const experiment = await ctx.db.insert('experiments', { owner: 'owner', title: 'Synthetic', runner, requestId: 'request', selection: '{}', attempts: 1, taskSet: 'task', report: id })
    const run = await ctx.db.insert('runnerRuns', { owner: 'owner', runner, experiment, requestId: 'request', profile, status: 'completed', phase: 'Finished', report: id })
    return { runner, experiment, run }
  })
  return { t, owner, id, ...references }
}
test('deletion removes private data and access, retains history and releases capacity', async () => {
  const { t, owner, id, run, experiment } = await setup()
  const token = 'a'.repeat(64)
  await owner.mutation(api.reports.share, { id, token })
  await owner.mutation(api.reportEvidence.add, { report: id, trial: fixture.rows[0].trial, title: 'Synthetic', kind: 'patch', text: '+ example' })
  await t.run(async ctx => {
    await ctx.db.insert('reportMembers', { report: id, user: 'viewer', label: 'Viewer', role: 'viewer' })
    await ctx.db.insert('reportInvites', { report: id, token: 'invite', role: 'viewer', expiresAt: 0, revoked: false })
    const job = await ctx.db.insert('presentationExports', { report: id, owner: 'owner', requestId: 'export', version: 1, status: 'complete', collection: false, preset: 'demo', theme: 'demo', snapshotId: 'demo', inputHash: 'demo' })
    await ctx.db.insert('presentationExportInputs', { job, payload: '{}', document: '{}' })
  })
  await owner.mutation(api.reports.remove, { id })
  expect(await owner.query(api.reports.get, { id })).toBeNull()
  expect(await t.query(api.reports.shared, { token })).toBeNull()
  await t.run(async ctx => {
    for (const table of ['reportData', 'reportProjects', 'reportRevisions', 'reportMembers', 'reportInvites', 'reportEvidence', 'presentationExports', 'presentationExportInputs'] as const) expect(await ctx.db.query(table).collect()).toEqual([])
    expect(await ctx.db.get(run)).toMatchObject({ status: 'completed' })
    expect((await ctx.db.get(run))!.report).toBeUndefined()
    expect((await ctx.db.get(experiment))!.report).toBeUndefined()
    expect(await storedReportCount(ctx, 'owner')).toBe(0)
    expect(await ctx.db.query('usedShareTokens').collect()).toHaveLength(1)
  })
})
test('only owners can delete, even when editors can change chart drafts', async () => {
  const { t, id } = await setup()
  for (const role of ['viewer', 'editor'] as const) {
    await t.run(ctx => ctx.db.insert('reportMembers', { report: id, user: role, label: role, role }))
    await expect(t.withIdentity({ subject: role }).mutation(api.reports.remove, { id })).rejects.toThrow('permission')
  }
  await expect(t.mutation(api.reports.remove, { id })).rejects.toThrow('Sign in')
  await expect(t.withIdentity({ subject: 'stranger' }).mutation(api.reports.remove, { id })).rejects.toThrow('not found')
})
test('active evaluations and rendering exports prevent deletion without partial cleanup', async () => {
  const { t, owner, id, run } = await setup()
  await t.run(ctx => ctx.db.patch(run, { status: 'cancelling' }))
  await expect(owner.mutation(api.reports.remove, { id })).rejects.toThrow('evaluation')
  await t.run(async ctx => {
    await ctx.db.patch(run, { status: 'completed' })
    await ctx.db.insert('presentationExports', { report: id, owner: 'owner', requestId: 'export', version: 1, status: 'rendering', collection: false, preset: 'demo', theme: 'demo', snapshotId: 'demo', inputHash: 'demo' })
  })
  await expect(owner.mutation(api.reports.remove, { id })).rejects.toThrow('export')
  expect(await owner.query(api.reports.get, { id })).not.toBeNull()
})
test('baseline reports cannot be deleted', async () => {
  const { t, owner, id, experiment } = await setup()
  await t.run(ctx => ctx.db.insert('comparisonBaselines', { owner: 'owner', title: 'Synthetic baseline', experiment, report: id, goal: 'custom', taskSet: 'task', attempts: 1, profiles: [profile], results: [] }))
  await expect(owner.mutation(api.reports.remove, { id })).rejects.toThrow('baseline')
  expect(await owner.query(api.reports.get, { id })).not.toBeNull()
})
