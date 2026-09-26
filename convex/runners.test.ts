/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { expect, test } from 'vitest'
import schema from './schema'
import { api } from './_generated/api'
import fixture from '../results/harbor/demo-evaluation.json'
import type { Id } from './_generated/dataModel'
import type { RunnerProfile } from '../src/runners/protocol'

const modules = import.meta.glob(['./**/*.ts', './**/*.js', '!./**/*.test.ts'])
const value = (n: number) => n.toString(16).padStart(64, '0')
const profile: RunnerProfile = { id: 'setup', digest: value(1), title: 'Setup check', benchmark: 'Heval setup', agent: 'oracle', model: 'Reference solution', tasks: 1, attempts: 1, timeoutSeconds: 300, setupCheck: true }
const output = JSON.stringify({ ...fixture, rows: [fixture.rows[0]] })
async function setup() {
  const t = convexTest(schema, modules), owner = t.withIdentity({ subject: 'owner' }), other = t.withIdentity({ subject: 'other' })
  const machine = async (n: number) => {
    await owner.mutation(api.runners.createPairing, { name: `Machine ${n}`, code: value(n) })
    const credential = value(n + 100), session = value(n + 200), claimId = value(n + 300)
    const { id } = await t.mutation(api.runners.connect, { code: value(n), credential })
    const poll = () => t.mutation(api.runners.poll, { credential, session, claimId, profiles: [profile], ready: true, health: 'Ready' })
    await poll()
    return { id, credential, session, claimId, poll }
  }
  const a = await machine(10), b = await machine(11)
  const enqueue = (runner = a.id, requestId = value(90)) => owner.mutation(api.runners.enqueue, { runner, profileId: profile.id, digest: profile.digest, requestId })
  return { t, owner, other, a, b, enqueue }
}

test('monitoring is claim scoped, owner only, bounded, replay safe and retained after completion', async () => {
  const { t, owner, other, a, b, enqueue } = await setup()
  const id = await enqueue(); await a.poll()
  const snapshot = { sequence: 2, sampledAt: Date.now(), trials: [{ id: 'task__one', state: 'passed' as const, startedAt: 10, updatedAt: 20, finishedAt: 20 }], events: [{ sequence: 1, at: 20, trial: 'task__one', state: 'passed' as const }] }
  const args = { credential: a.credential, session: a.session, claimId: a.claimId, id, snapshot }
  await expect(t.mutation(api.runners.monitor, { ...args, credential: b.credential, session: b.session })).rejects.toThrow('does not belong')
  await expect(t.mutation(api.runners.monitor, { ...args, session: value(999) })).rejects.toThrow('Another runner session')
  await t.mutation(api.runners.monitor, args)
  await t.mutation(api.runners.monitor, { ...args, snapshot: { ...snapshot, sequence: 1, trials: [], events: [] } })
  expect(await owner.query(api.runners.monitoring, { id, details: false })).toMatchObject({ sequence: 2, counts: { passed: 1 }, trials: [], events: [] })
  await expect(other.query(api.runners.monitoring, { id, details: true })).rejects.toThrow('not found')
  await expect(t.query(api.runners.monitoring, { id, details: true })).rejects.toThrow('Sign in')
  await expect(t.mutation(api.runners.monitor, { ...args, snapshot: { ...snapshot, sequence: 3, trials: [...snapshot.trials, { ...snapshot.trials[0], id: 'two' }] } })).rejects.toThrow('Invalid monitoring')
  await t.mutation(api.runners.finish, { credential: a.credential, session: a.session, claimId: a.claimId, id, status: 'completed', json: output })
  await t.mutation(api.runners.monitor, { ...args, snapshot: { ...snapshot, sequence: 4 } })
  expect(await owner.query(api.runners.monitoring, { id, details: true })).toMatchObject({ sequence: 2, trials: snapshot.trials, events: snapshot.events })
})
test('pairing requires an owner, is one-use, expires, and stores digests only', async () => {
  const { t, owner, a } = await setup()
  await expect(t.mutation(api.runners.createPairing, { name: 'bad', code: value(80) })).rejects.toThrow('Sign in')
  expect(await t.mutation(api.runners.connect, { code: value(10), credential: a.credential })).toMatchObject({ id: a.id })
  await expect(t.mutation(api.runners.connect, { code: value(10), credential: value(500) })).rejects.toThrow('already used')
  const stored = await t.run(ctx => ctx.db.get(a.id))
  expect(JSON.stringify(stored)).not.toContain(a.credential)
  expect(JSON.stringify(await owner.query(api.runners.list))).not.toContain('credential')
  await owner.mutation(api.runners.createPairing, { name: 'Expired', code: value(88) })
  await t.run(async ctx => { const entries = await ctx.db.query('runnerPairings').collect(); for (const e of entries) await ctx.db.patch(e._id, { expiresAt: Date.now() - 1 }) })
  await expect(t.mutation(api.runners.connect, { code: value(88), credential: value(188) })).rejects.toThrow('expired')
})
test('idempotent enqueue and poll never duplicate work, including after reconnection', async () => {
  const { t, owner, a, b, enqueue } = await setup()
  const id = await enqueue()
  expect(await enqueue()).toBe(id)
  const claimed = await a.poll()
  expect(claimed).toMatchObject({ id, claimId: a.claimId })
  expect(await a.poll()).toEqual(claimed)
  expect(await b.poll()).toBeNull()
  await expect(t.mutation(api.runners.poll, { credential: a.credential, session: value(999), claimId: value(998), profiles: [profile], ready: true, health: 'Ready' })).rejects.toThrow('Another runner session')
  await t.run(ctx => ctx.db.patch(a.id, { leaseUntil: 0 }))
  const reconnect = await t.mutation(api.runners.poll, { credential: a.credential, session: value(999), claimId: value(998), profiles: [profile], ready: true, health: 'Ready' })
  expect(reconnect).toEqual(claimed)
  expect(await owner.query(api.runners.runs)).toHaveLength(1)
  await expect(t.mutation(api.runners.finish, { credential: a.credential, session: a.session, id, claimId: a.claimId, status: 'completed', json: output })).rejects.toThrow('Another runner session')
})
test('browser ownership and runner claims cannot cross accounts or machines', async () => {
  const { t, other, a, b, enqueue } = await setup()
  const id = await enqueue(); await a.poll()
  expect(await other.query(api.runners.list)).toEqual([])
  expect(await other.query(api.runners.runs)).toEqual([])
  await expect(other.mutation(api.runners.cancel, { id })).rejects.toThrow('not found')
  await expect(other.mutation(api.runners.revoke, { id: a.id })).rejects.toThrow('not found')
  await expect(other.mutation(api.runners.enqueue, { runner: a.id, profileId: profile.id, digest: profile.digest, requestId: value(91) })).rejects.toThrow('not found')
  await expect(t.mutation(api.runners.finish, { credential: b.credential, session: b.session, claimId: a.claimId, id, status: 'completed', json: output })).rejects.toThrow('does not belong')
  await expect(t.mutation(api.runners.poll, { credential: value(444), session: a.session, claimId: a.claimId, profiles: [], ready: true, health: '' })).rejects.toThrow('invalid')
})
test('queued work can move only to an online matching profile; a claimed run stays put', async () => {
  const { owner, a, b, enqueue } = await setup()
  const id = await enqueue()
  await owner.mutation(api.runners.moveQueued, { id, runner: b.id })
  expect(await a.poll()).toBeNull()
  expect(await b.poll()).toMatchObject({ id })
  await expect(owner.mutation(api.runners.moveQueued, { id, runner: a.id })).rejects.toThrow('Only queued')
})
test('completion creates one private report and repeated uploads return it', async () => {
  const { t, owner, a, enqueue } = await setup()
  const id = await enqueue(); await a.poll()
  const args = { credential: a.credential, session: a.session, claimId: a.claimId, id, status: 'completed' as const, json: output }
  const saved = await t.mutation(api.runners.finish, args)
  expect(saved.report).toBeTruthy()
  expect(await t.mutation(api.runners.finish, args)).toEqual(saved)
  expect(await owner.query(api.reports.list)).toHaveLength(1)
  expect(await owner.query(api.reports.get, { id: saved.report as Id<'reports'> })).toMatchObject({ shareToken: null })
  expect(await owner.query(api.runners.runs)).toMatchObject([{ status: 'completed', report: saved.report }])
  expect(await a.poll()).toBeNull()
})
test('cancellation requires physical acknowledgment once running', async () => {
  const { t, owner, a, enqueue } = await setup()
  const queued = await enqueue()
  await owner.mutation(api.runners.cancel, { id: queued })
  expect(await a.poll()).toBeNull()
  const id = await enqueue(a.id, value(92)); await a.poll()
  await owner.mutation(api.runners.cancel, { id })
  expect(await a.poll()).toMatchObject({ id, cancel: true })
  expect((await owner.query(api.runners.runs))[0].status).toBe('cancelling')
  await t.mutation(api.runners.finish, { credential: a.credential, session: a.session, claimId: a.claimId, id, status: 'cancelled' })
  expect((await owner.query(api.runners.runs))[0].status).toBe('cancelled')
})
test('revocation denies polling and result upload and cancels pending work', async () => {
  const { t, owner, a, enqueue } = await setup()
  const id = await enqueue(); await a.poll()
  await enqueue(a.id, value(93))
  await owner.mutation(api.runners.revoke, { id: a.id })
  await expect(a.poll()).rejects.toThrow('revoked')
  await expect(t.mutation(api.runners.finish, { credential: a.credential, session: a.session, claimId: a.claimId, id, status: 'completed', json: output })).rejects.toThrow('revoked')
  expect((await owner.query(api.runners.runs)).map(r => r.status).sort()).toEqual(['cancelled', 'interrupted'])
})
test('offline and changed profiles are rejected before execution', async () => {
  const { t, owner, a, enqueue } = await setup()
  await expect(owner.mutation(api.runners.enqueue, { runner: a.id, profileId: profile.id, digest: value(333), requestId: value(91) })).rejects.toThrow('profile changed')
  await t.run(ctx => ctx.db.patch(a.id, { lastSeen: 0 }))
  await expect(enqueue()).rejects.toThrow('Connect this machine')
  await a.poll(); await enqueue()
  expect(await t.mutation(api.runners.poll, { credential: a.credential, session: a.session, claimId: a.claimId, profiles: [{ ...profile, digest: value(999) }], ready: true, health: 'Ready' })).toBeNull()
  expect((await owner.query(api.runners.runs))[0].status).toBe('failed')
})

test('an account connects at most three workers; disconnected ones free a slot', async () => {
  const { t, owner, a } = await setup()
  await owner.mutation(api.runners.createPairing, { name: 'Machine 12', code: value(12) })
  await t.mutation(api.runners.connect, { code: value(12), credential: value(112) })
  await expect(owner.mutation(api.runners.createPairing, { name: 'Machine 13', code: value(13) })).rejects.toThrow('3 connected workers')
  await owner.mutation(api.runners.revoke, { id: a.id })
  await owner.mutation(api.runners.createPairing, { name: 'Machine 13', code: value(13) })
  await t.mutation(api.runners.connect, { code: value(13), credential: value(113) })
  expect((await owner.query(api.runners.list, {})).filter(m => !m.revoked)).toHaveLength(3)
})

test('a switched-off worker finishes nothing new: no claims, enqueues, or moves until switched on', async () => {
  const { owner, other, a, b, enqueue } = await setup()
  const queued = await enqueue()
  await expect(other.mutation(api.runners.setEnabled, { id: a.id, enabled: false })).rejects.toThrow('Machine not found')
  await owner.mutation(api.runners.setEnabled, { id: a.id, enabled: false })
  expect(await a.poll()).toBeNull()
  await expect(enqueue(a.id, value(91))).rejects.toThrow('switched off')
  await owner.mutation(api.runners.setEnabled, { id: b.id, enabled: false })
  await expect(owner.mutation(api.runners.moveQueued, { id: queued, runner: b.id })).rejects.toThrow('switched off')
  await owner.mutation(api.runners.setEnabled, { id: a.id, enabled: true })
  expect((await a.poll())?.id).toBe(queued)
  expect((await owner.query(api.runners.list, {})).find(m => m.id === b.id)?.enabled).toBe(false)
})

test('workers report their machine kind; the owner can override and clear it', async () => {
  const { t, owner, a } = await setup()
  await t.mutation(api.runners.poll, { credential: a.credential, session: a.session, claimId: a.claimId, profiles: [profile], ready: true, health: 'Ready', machine: 'laptop' })
  await a.poll() // Older workers omit the kind; the last report stays.
  const find = async () => (await owner.query(api.runners.list, {})).find(m => m.id === a.id)!
  expect(await find()).toMatchObject({ machine: 'laptop', icon: null })
  await owner.mutation(api.runners.setIcon, { id: a.id, icon: 'mac-mini' })
  expect((await find()).icon).toBe('mac-mini')
  await owner.mutation(api.runners.setIcon, { id: a.id, icon: null })
  expect(await find()).toMatchObject({ machine: 'laptop', icon: null })
})

test('pairing status identifies only the matching owner computer and hides revoked connections', async () => {
 const {t,owner,other,a}=await setup()
 expect(await owner.query(api.runners.pairingStatus,{code:value(10)})).toBe(a.id)
 expect(await other.query(api.runners.pairingStatus,{code:value(10)})).toBeNull()
 expect(await owner.query(api.runners.pairingStatus,{code:value(89)})).toBeNull()
 await expect(t.query(api.runners.pairingStatus,{code:value(10)})).rejects.toThrow('Sign in')
 await owner.mutation(api.runners.revoke,{id:a.id})
 expect(await owner.query(api.runners.pairingStatus,{code:value(10)})).toBeNull()
})

test('worker rate cards stay owner-only, persist across ordinary polls, and clear on disconnect', async () => {
  const { t, owner, other, a } = await setup()
  const modelCatalog = { fetchedAt: '2026-09-25T00:00:00Z', models: [{ model: 'zai/glm-5.3', displayName: 'GLM-5.3', creator: 'zai', vendors: [{ vendor: 'zai', status: 'available', inputPerMillion: 0.7, outputPerMillion: 2.2, cacheReadPerMillion: null, contextWindow: 1000000, maxOutputTokens: 100000, supportsToolCalling: true, supportsReasoning: true }] }] }
  const args = { credential: a.credential, session: a.session, claimId: a.claimId, profiles: [profile], ready: true, health: 'Ready' }
  await t.mutation(api.runners.poll, { ...args, modelCatalog })
  await a.poll()
  expect((await owner.query(api.runners.list)).find(r => r.id === a.id)?.modelCatalog).toEqual(modelCatalog)
  expect(await other.query(api.runners.list)).toEqual([])
  await expect(t.query(api.runners.list)).rejects.toThrow('Sign in')
  await t.mutation(api.runners.poll, { ...args, modelCatalog: null })
  expect((await owner.query(api.runners.list)).find(r => r.id === a.id)?.modelCatalog).toBeNull()
})
