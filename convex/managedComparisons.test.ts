/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, expect, test, vi } from 'vitest'
import schema from './schema'
import { api } from './_generated/api'
import { BENCHMARKS } from '../src/runners/benchmarks'
import type { RunnerProfile } from '../src/runners/protocol'
import fixture from '../results/harbor/demo-evaluation.json'
const modules = import.meta.glob(['./**/*.ts', './**/*.js', '!./**/*.test.ts'])
const key = (n: number) => n.toString(16).padStart(64, '0')
const task = BENCHMARKS.find(b => b.id === 'tblite-smoke')!
afterEach(() => vi.unstubAllEnvs())
async function setup() {
  vi.stubEnv('HEVAL_MANAGED_ENABLED', '1'); vi.stubEnv('HEVAL_MANAGED_CONTROL_TOKEN', key(1)); vi.stubEnv('HEVAL_MANAGED_ALLOWED_USERS', 'owner')
  vi.stubEnv('HEVAL_MANAGED_POLICY_JSON', JSON.stringify({ snapshot: 'heval-tested-fixture-v1', benchmark: 'tblite-smoke', taskSet: task.taskSet, tasks: task.tasks, models: ['test/model', 'test/other'], harnesses: ['codex', 'pi'], maxBudgetUsd: 5, maxMinutes: 30 }))
  const t = convexTest(schema, modules), owner = t.withIdentity({ subject: 'owner' }), stranger = t.withIdentity({ subject: 'stranger' })
  const claim = (lease = key(2)) => t.mutation(api.managedComparisons.claim, { token: key(1), lease })
  await claim()
  const args = { title: 'Synthetic managed comparison', requestId: key(10), spec: { goal: 'harnesses' as const, harnesses: ['codex', 'pi'], models: ['test/model'], budgetUsd: 2, minutes: 20 } }
  const profiles: RunnerProfile[] = [
    { id: 'check', agent: 'oracle', setupCheck: true, model: 'Reference solution', tasks: 1, taskSet: key(99) },
    ...['codex', 'pi'].map(agent => ({ id: agent, agent, setupCheck: false, model: 'test/model', tasks: 5, taskSet: task.taskSet })),
  ].map((p, i) => ({ ...p, digest: key(30 + i), title: p.id, benchmark: 'Synthetic fixture', vendor: 'Provider default', attempts: 1, maxAttempts: 1, timeoutSeconds: 600, runSettingsVersion: 1 }))
  return { t, owner, stranger, args, claim, profiles }
}

test('managed launch is disabled without configuration, invite, and a live coordinator', async () => {
  const { t, owner, stranger, args } = await setup()
  expect((await owner.query(api.managedComparisons.catalog)).available).toBe(true)
  expect((await stranger.query(api.managedComparisons.catalog)).available).toBe(false)
  await expect(stranger.mutation(api.managedComparisons.create, args)).rejects.toThrow('invited')
  vi.stubEnv('HEVAL_MANAGED_ENABLED', '')
  await expect(owner.mutation(api.managedComparisons.create, args)).rejects.toThrow('invited')
  vi.stubEnv('HEVAL_MANAGED_ENABLED', '1')
  await t.run(async ctx => { const row = await ctx.db.query('managedController').first(); await ctx.db.patch(row!._id, { lastSeen: 0 }) })
  await expect(owner.mutation(api.managedComparisons.create, args)).rejects.toThrow('offline')
  await expect(t.mutation(api.managedComparisons.claim, { token: key(3), lease: key(2) })).rejects.toThrow('authorization')
})

test('managed submission validates budget and matrix, reserves capacity, and is idempotent', async () => {
  const { t, owner, stranger, args } = await setup()
  await expect(owner.mutation(api.managedComparisons.create, { ...args, spec: { ...args.spec, budgetUsd: 6 } })).rejects.toThrow('limits')
  await expect(owner.mutation(api.managedComparisons.create, { ...args, spec: { ...args.spec, models: ['unapproved/model'] } })).rejects.toThrow('approved')
  const id = await owner.mutation(api.managedComparisons.create, args)
  expect(await owner.mutation(api.managedComparisons.create, args)).toBe(id)
  await expect(owner.mutation(api.managedComparisons.create, { ...args, title: 'Changed' })).rejects.toThrow('another comparison')
  await expect(owner.mutation(api.managedComparisons.create, { ...args, requestId: key(11) })).rejects.toThrow('active')
  await expect(stranger.query(api.managedComparisons.get, { id })).rejects.toThrow('not found')
  const job = await owner.query(api.managedComparisons.get, { id })
  expect(job).not.toHaveProperty('lease'); expect(job).not.toHaveProperty('snapshot'); expect(job).not.toHaveProperty('owner')
  await owner.mutation(api.managedComparisons.cancel, { id })
  expect((await owner.query(api.managedComparisons.get, { id })).status).toBe('cancelled')
  await t.run(async ctx => { for (let i = 0; i < 97; i++) await ctx.db.insert('reports', { owner: 'owner', title: 'Fixture', trials: 1, shareToken: null }) })
  await expect(owner.mutation(api.managedComparisons.create, { ...args, requestId: key(12) })).rejects.toThrow('report storage')
})

test('global execution is leased and restart recovery returns the original job', async () => {
  const { t, owner, args, claim, profiles } = await setup()
  const id = await owner.mutation(api.managedComparisons.create, args)
  const job = (await claim())!
  expect(job._id).toBe(id)
  await t.mutation(api.managedComparisons.renew, { id, token: key(1), lease: key(2) })
  await expect(t.mutation(api.managedComparisons.finish, { id, token: key(1), lease: key(2), outcome: 'completed' })).rejects.toThrow('cleanup')
  expect(await claim(key(3))).toBeNull()
  await t.run(ctx => ctx.db.patch(id, { leaseUntil: 0 }))
  expect((await claim(key(3)))!._id).toBe(id)
  await expect(t.mutation(api.managedComparisons.renew, { id, token: key(1), lease: key(2) })).rejects.toThrow('lease expired')
  await expect(t.mutation(api.managedComparisons.ready, { id, token: key(1), lease: key(2), credential: key(4), profiles })).rejects.toThrow('lease expired')
  expect(await owner.query(api.experiments.list)).toHaveLength(0)
})

test('managed worker history cannot hide personal machines or consume their connection limit', async () => {
  const { t, owner } = await setup()
  await t.run(async ctx => {
    const base = { owner: 'owner', name: 'Personal history', credentialHash: key(90), revoked: true, ready: false, lastSeen: 0, health: 'Disconnected', profiles: [], leaseUntil: 0 }
    await ctx.db.insert('runners', base)
    for (let i = 0; i < 60; i++) await ctx.db.insert('runners', { ...base, name: 'Managed history', managed: true, credentialHash: key(100 + i) })
  })
  expect((await owner.query(api.runners.list)).map(r => r.name)).toEqual(['Personal history'])
  for (let i = 0; i < 3; i++) {
    await owner.mutation(api.runners.createPairing, { name: `Personal ${i}`, code: key(200 + i) })
    await t.mutation(api.runners.connect, { code: key(200 + i), credential: key(210 + i) })
  }
  expect(await owner.query(api.runners.list)).toHaveLength(4)
  await expect(owner.mutation(api.runners.createPairing, { name: 'Excess', code: key(230) })).rejects.toThrow('connected workers')
})

test('activation checks task pins, atomically queues Oracle first, and blocks personal runner APIs', async () => {
  const { t, owner, args, claim, profiles } = await setup()
  const id = await owner.mutation(api.managedComparisons.create, args)
  await claim()
  const activate = { id, token: key(1), lease: key(2), credential: key(4), profiles }
  await expect(t.mutation(api.managedComparisons.ready, { ...activate, profiles: profiles.map(p => p.setupCheck ? p : { ...p, taskSet: key(80) }) })).rejects.toThrow('approved comparison')
  const ready = await t.mutation(api.managedComparisons.ready, activate)
  expect(await t.mutation(api.managedComparisons.ready, activate)).toEqual(ready)
  expect(await owner.query(api.runners.list)).toEqual([])
  await expect(owner.mutation(api.runners.setEnabled, { id: ready.runner, enabled: false })).rejects.toThrow('managed comparison controls')
  await expect(owner.mutation(api.experiments.create, { runner: ready.runner, title: 'Bypass', requestId: key(60), attempts: 1, profiles: profiles.slice(1).map(p => ({ id: p.id, digest: p.digest })) })).rejects.toThrow('managed workflow')
  const run = await t.mutation(api.runners.poll, { credential: key(4), session: key(5), claimId: key(6), profiles, ready: true, health: 'Ready' })
  expect(run!.profile.agent).toBe('oracle')
  await owner.mutation(api.experiments.cancel, { id: ready.experiment })
  expect((await owner.query(api.managedComparisons.get, { id })).status).toBe('stopping')
  await t.mutation(api.managedComparisons.cleanup, { id, token: key(1), lease: key(2), outcome: 'cancelled' })
  await t.mutation(api.managedComparisons.finish, { id, token: key(1), lease: key(2), outcome: 'cancelled' })
  expect((await owner.query(api.managedComparisons.get, { id })).status).toBe('cancelled')
  await expect(t.mutation(api.runners.poll, { credential: key(4), session: key(5), claimId: key(6), profiles, ready: true, health: 'Ready' })).rejects.toThrow('revoked')
})

test('the managed protocol produces private reports and a repeatable managed baseline', async () => {
  const { t, owner, args, claim, profiles } = await setup()
  const id = await owner.mutation(api.managedComparisons.create, args)
  await claim()
  const ready = await t.mutation(api.managedComparisons.ready, { id, token: key(1), lease: key(2), credential: key(4), profiles })
  for (let i = 0; i < 3; i++) {
    const run = (await t.mutation(api.runners.poll, { credential: key(4), session: key(5), claimId: key(6), profiles, ready: true, health: 'Ready' }))!
    expect(run.profile.agent === 'oracle').toBe(i === 0)
    await t.mutation(api.runners.finish, { credential: key(4), session: key(5), claimId: key(6), id: run.id, status: 'completed', json: JSON.stringify({ ...fixture, rows: fixture.rows.slice(0, run.profile.tasks) }) })
  }
  const progress = await t.mutation(api.managedComparisons.progress, { id, token: key(1), lease: key(2) })
  expect(progress).toMatchObject({ complete: true, failed: false })
  const experiment = await owner.query(api.experiments.get, { id: ready.experiment })
  expect(experiment.report).toBeTruthy()
  expect((await owner.query(api.reports.get, { id: experiment.report! }))!.shareToken).toBeNull()
  const baseline = await owner.mutation(api.baselines.save, { experiment: ready.experiment, title: 'Managed baseline' })
  expect((await owner.query(api.baselines.get, { id: baseline })).execution).toBe('managed')
  await t.mutation(api.managedComparisons.cleanup, { id, token: key(1), lease: key(2), outcome: 'completed' })
  await t.mutation(api.managedComparisons.finish, { id, token: key(1), lease: key(2), outcome: 'completed' })
  expect((await owner.query(api.managedComparisons.get, { id })).status).toBe('completed')
  const repeated = await owner.mutation(api.managedComparisons.create, { ...args, requestId: key(71), baseline })
  expect(repeated).not.toBe(id)
  await expect(owner.mutation(api.managedComparisons.create, { ...args, requestId: key(72), baseline, spec: { ...args.spec, minutes: 25 } })).rejects.toThrow('active')
})
