/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { expect, test } from 'vitest'
import schema from './schema'
import { api } from './_generated/api'
import fixture from '../tests/fixtures/report-sharing.json'
import { parseReport } from '../src/reports/format'
import { initialReportProject } from '../src/reports/project'
import type { RunnerProfile } from '../src/runners/protocol'

const modules = import.meta.glob(['./**/*.ts', './**/*.js', '!./**/*.test.ts'])
const key = (n: number) => n.toString(16).padStart(64, '0')
const profile: RunnerProfile = {
  id: 'model-check', digest: key(1), title: 'SYNTHETIC model check', benchmark: 'Synthetic fixture',
  agent: 'codex', model: 'synthetic/model', vendor: 'synthetic', taskSet: key(2), maxAttempts: 1,
  tasks: 1, attempts: 1, timeoutSeconds: 300, setupCheck: false,
}
const oracle: RunnerProfile = { ...profile, id: 'worker-check', agent: 'oracle', model: 'oracle', setupCheck: true }
const json = JSON.stringify({ ...fixture, rows: [{ ...fixture.rows[0], passed: 1, reward: 1 }] })
const payload = { json, title: 'SYNTHETIC imported report' }

async function setup(existing: number) {
  const t = convexTest(schema, modules), owner = t.withIdentity({ subject: 'owner' })
  await t.run(async ctx => {
    for (let i = 0; i < existing; i++) await ctx.db.insert('reports', { owner: 'owner', title: 'Existing report', trials: 1, shareToken: null })
  })
  await owner.mutation(api.runners.createPairing, { name: 'Synthetic worker', code: key(10) })
  const credential = key(11), session = key(12), claimId = key(13)
  const { id: runner } = await t.mutation(api.runners.connect, { code: key(10), credential })
  const poll = () => t.mutation(api.runners.poll, { credential, session, claimId, profiles: [oracle, profile], ready: true, health: 'Synthetic ready' })
  await poll()
  const create = (request: number, checkWorker = false) => owner.mutation(api.experiments.create, {
    runner, title: `SYNTHETIC experiment ${request}`, requestId: key(request), attempts: 1,
    profiles: [{ id: profile.id, digest: profile.digest }], ...(checkWorker ? { checkWorker: true } : {}),
  })
  const enqueue = (request: number) => owner.mutation(api.runners.enqueue, { runner, profileId: profile.id, digest: profile.digest, requestId: key(request) })
  const finish = async (status: 'completed' | 'failed' | 'cancelled', output?: string) => {
    const run = await poll()
    if (!run) throw new Error('Expected an accepted run to be claimable')
    return t.mutation(api.runners.finish, { credential, session, claimId, id: run.id, status, ...(output ? { json: output } : {}) })
  }
  return { t, owner, runner, create, enqueue, poll, finish }
}

test('each accepted experiment reserves its individual and combined reports', async () => {
  const { owner, create, finish, poll } = await setup(96)
  const first = await create(20), second = await create(21)
  await expect(create(22)).rejects.toThrow('report storage')
  expect(await create(20)).toBe(first)
  expect(await create(21)).toBe(second)
  expect(await owner.query(api.experiments.list)).toHaveLength(2)
  expect(await owner.query(api.runners.runs)).toHaveLength(2)
  for (const id of [first, second]) {
    await finish('completed', json)
    const experiment = await owner.query(api.experiments.get, { id })
    expect(experiment.cells[0].status).toBe('completed')
    expect(experiment.cells[0].report).toBeTruthy()
    expect(experiment.report).toBeTruthy()
  }
  expect(await owner.query(api.reports.list)).toHaveLength(100)
  expect(await poll()).toBeNull()
})

test.each(['save', 'saveProject'] as const)('%s cannot consume report slots reserved by accepted work', async method => {
  const { owner, create, enqueue, finish } = await setup(98)
  const id = await create(20)
  if (method === 'save') await expect(owner.mutation(api.reports.save, payload)).rejects.toThrow('100-report limit')
  else {
    const document = await initialReportProject(parseReport(json), 'synthetic-source', payload.title)
    await expect(owner.mutation(api.reports.saveProject, { json, document: JSON.stringify(document) })).rejects.toThrow('100-report limit')
  }
  await expect(enqueue(21)).rejects.toThrow('report storage')
  expect(await owner.query(api.reports.list)).toHaveLength(98)
  await finish('completed', json)
  expect((await owner.query(api.experiments.get, { id })).report).toBeTruthy()
  expect(await owner.query(api.reports.list)).toHaveLength(100)
})

test('individual runs reserve outputs while allowing imports into unreserved space', async () => {
  const { owner, enqueue, finish, poll } = await setup(98)
  const run = await enqueue(20)
  await owner.mutation(api.reports.save, payload)
  expect(await enqueue(20)).toBe(run)
  await expect(enqueue(21)).rejects.toThrow('report storage')
  await expect(owner.mutation(api.reports.save, payload)).rejects.toThrow('100-report limit')
  await finish('completed', json)
  expect(await owner.query(api.reports.list)).toHaveLength(100)
  expect(await poll()).toBeNull()
})

test('cancelling a queued experiment releases both its output reservations', async () => {
  const { owner, create, enqueue } = await setup(98)
  const id = await create(20)
  await owner.mutation(api.experiments.cancel, { id })
  expect((await owner.query(api.experiments.get, { id })).report).toBeNull()
  await owner.mutation(api.reports.save, payload)
  await enqueue(21)
  await expect(owner.mutation(api.reports.save, payload)).rejects.toThrow('100-report limit')
})

test('running cancellation keeps reservations until the worker acknowledges its result', async () => {
  const { owner, create, poll, finish } = await setup(98)
  const id = await create(20)
  await poll()
  await owner.mutation(api.experiments.cancel, { id })
  await expect(owner.mutation(api.reports.save, payload)).rejects.toThrow('100-report limit')
  await finish('cancelled', json)
  const experiment = await owner.query(api.experiments.get, { id })
  expect(experiment.cells[0].status).toBe('cancelled')
  expect(experiment.report).toBeTruthy()
  expect(await owner.query(api.reports.list)).toHaveLength(100)
})

test('a cancelled run with no report releases its experiment reservation', async () => {
  const { owner, create, poll, finish } = await setup(98)
  const id = await create(20)
  await poll()
  await owner.mutation(api.experiments.cancel, { id })
  await finish('cancelled')
  expect((await owner.query(api.experiments.get, { id })).report).toBeNull()
  await owner.mutation(api.reports.save, payload)
  await owner.mutation(api.reports.save, payload)
  expect(await owner.query(api.reports.list)).toHaveLength(100)
})

test('the prerequisite worker check reserves its own report separately from the combined result', async () => {
  const { owner, create, finish } = await setup(97)
  const id = await create(20, true)
  await expect(owner.mutation(api.reports.save, payload)).rejects.toThrow('100-report limit')
  await finish('completed', json)
  await expect(owner.mutation(api.reports.save, payload)).rejects.toThrow('100-report limit')
  await finish('completed', json)
  const experiment = await owner.query(api.experiments.get, { id })
  expect(experiment.setup?.report).toBeTruthy()
  expect(experiment.report).toBeTruthy()
  expect(await owner.query(api.reports.list)).toHaveLength(100)
})

test('a failed prerequisite with no output releases capacity after its model runs are rejected', async () => {
  const { owner, create, finish, poll } = await setup(97)
  const id = await create(20, true)
  await finish('failed')
  expect(await poll()).toBeNull()
  expect((await owner.query(api.experiments.get, { id })).cells[0].status).toBe('failed')
  await owner.mutation(api.reports.save, payload)
  await owner.mutation(api.reports.save, payload)
  await owner.mutation(api.reports.save, payload)
  expect(await owner.query(api.reports.list)).toHaveLength(100)
})

test('legacy overbooked work saves its individual outcome without exceeding the report cap', async () => {
  const { t, owner, create, finish } = await setup(98)
  const id = await create(20)
  await t.run(ctx => ctx.db.insert('reports', { owner: 'owner', title: 'Legacy unreserved import', trials: 1, shareToken: null }))
  await finish('completed', json)
  const experiment = await owner.query(api.experiments.get, { id })
  expect(experiment.cells[0].status).toBe('completed')
  expect(experiment.cells[0].report).toBeTruthy()
  expect(experiment.report).toBeNull()
  expect(await owner.query(api.reports.list)).toHaveLength(100)
  expect(await t.run(ctx => ctx.db.query('reports').collect())).toHaveLength(100)
})

test('combined reports preserve individual output slots after legacy imports overbook multiple experiments', async () => {
  const { t, owner, runner, create, finish, poll } = await setup(96)
  const first = await create(20), second = await create(21)
  await t.run(async ctx => {
    for (let i = 0; i < 2; i++) await ctx.db.insert('reports', { owner: 'owner', title: 'Legacy unreserved import', trials: 1, shareToken: null })
  })
  for (const id of [first, second]) {
    await finish('completed', json)
    const experiment = await owner.query(api.experiments.get, { id })
    expect(experiment.cells[0].status).toBe('completed')
    expect(experiment.cells[0].report).toBeTruthy()
    expect((await t.run(ctx => ctx.db.get(runner)))?.activeRun).toBeUndefined()
  }
  for (const id of [first, second]) expect((await owner.query(api.experiments.get, { id })).report).toBeNull()
  expect(await poll()).toBeNull()
  expect(await t.run(ctx => ctx.db.query('reports').collect())).toHaveLength(100)
  await expect(owner.mutation(api.reports.save, payload)).rejects.toThrow('100-report limit')
})
