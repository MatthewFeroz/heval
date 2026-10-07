/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { expect, test } from 'vitest'
import schema from './schema'
import { api } from './_generated/api'
import fixture from '../tests/fixtures/report-sharing.json'
import { parseReport } from '../src/reports/format'

const modules = import.meta.glob(['./**/*.ts', './**/*.js', '!./**/*.test.ts'])
const payload = { json: JSON.stringify(fixture), title: 'SYNTHETIC access check' }
const token = 'a'.repeat(64)
const identity = { subject: 'owner', issuer: 'https://api.workos.com/' }

test('private import → owner reload → anonymous share → revoke → new link', async () => {
  const t = convexTest(schema, modules)
  const owner = t.withIdentity(identity)
  const id = await owner.mutation(api.reports.save, payload)
  expect(await owner.query(api.reports.list)).toMatchObject([{ id, title: payload.title, shared: false }])
  expect(await owner.query(api.reports.get, { id })).toMatchObject({ title: payload.title, shareToken: null })
  await expect(t.query(api.reports.get, { id })).rejects.toThrow('Sign in')
  expect(await t.query(api.reports.shared, { token })).toBeNull()
  await owner.mutation(api.reports.share, { id, token })
  const shared = await t.query(api.reports.shared, { token })
  expect(shared).toMatchObject({ title: payload.title })
  expect(Object.keys(shared!).sort()).toEqual(['data', 'project', 'title', 'version'])
  expect(JSON.parse(shared!.data).rows).toHaveLength(fixture.rows.length)
  await owner.mutation(api.reports.revoke, { id })
  expect(await t.query(api.reports.shared, { token })).toBeNull()
  expect(await owner.query(api.reports.get, { id })).not.toBeNull()
  await expect(owner.mutation(api.reports.share, { id, token })).rejects.toThrow('retry')
  await owner.mutation(api.reports.share, { id, token: 'b'.repeat(64) })
  expect(await t.query(api.reports.shared, { token })).toBeNull()
  expect(await t.query(api.reports.shared, { token: 'b'.repeat(64) })).not.toBeNull()
})
test('ownership and unauthenticated mutation boundaries', async () => {
  const t = convexTest(schema, modules)
  const owner = t.withIdentity(identity)
  const other = t.withIdentity({ ...identity, subject: 'other' })
  const id = await owner.mutation(api.reports.save, payload)
  expect(await other.query(api.reports.list)).toEqual([])
  expect(await other.query(api.reports.get, { id })).toBeNull()
  await expect(other.mutation(api.reports.share, { id, token })).rejects.toThrow('not found')
  await expect(other.mutation(api.reports.revoke, { id })).rejects.toThrow('not found')
  await expect(t.mutation(api.reports.save, payload)).rejects.toThrow('Sign in')
  await expect(t.mutation(api.reports.share, { id, token })).rejects.toThrow('Sign in')
  await expect(t.mutation(api.reports.revoke, { id })).rejects.toThrow('Sign in')
  await expect(t.query(api.reports.list)).rejects.toThrow('Sign in')
})
test('a published connected report grants neither anonymous nor team access to its worker', async () => {
  const t = convexTest(schema, modules), owner = t.withIdentity(identity)
  const profile = { id: 'synthetic-check', digest: '1'.repeat(64), title: 'SYNTHETIC worker check', benchmark: 'Synthetic fixture', agent: 'oracle', model: 'Synthetic reference', tasks: 4, attempts: 1, timeoutSeconds: 300, setupCheck: true }
  const code = '2'.repeat(64), credential = '3'.repeat(64), session = '4'.repeat(64), claimId = '5'.repeat(64)
  await owner.mutation(api.runners.createPairing, { name: 'Synthetic worker', code })
  const { id: runner } = await t.mutation(api.runners.connect, { code, credential })
  const poll = { credential, session, claimId, profiles: [profile], ready: true, health: 'Synthetic ready' }
  await t.mutation(api.runners.poll, poll)
  const run = await owner.mutation(api.runners.enqueue, { runner, profileId: profile.id, digest: profile.digest, requestId: '6'.repeat(64) })
  await t.mutation(api.runners.poll, poll)
  const { report: id } = await t.mutation(api.runners.finish, { credential, session, claimId, id: run, status: 'completed', json: payload.json })
  expect(id).not.toBeNull()
  if (!id) throw new Error('Synthetic worker did not produce a report')
  await owner.mutation(api.reports.share, { id, token })
  expect(Object.keys((await t.query(api.reports.shared, { token }))!).sort()).toEqual(['data', 'project', 'title', 'version'])
  await expect(t.query(api.runners.list)).rejects.toThrow('Sign in')
  await expect(t.mutation(api.runners.enqueue, { runner, profileId: profile.id, digest: profile.digest, requestId: '7'.repeat(64) })).rejects.toThrow('Sign in')
  await expect(t.mutation(api.runners.revoke, { id: runner })).rejects.toThrow('Sign in')
  for (const [index, role] of (['viewer', 'editor'] as const).entries()) {
    const member = t.withIdentity({ subject: `synthetic-${role}` }), invitation = String(index + 8).repeat(64)
    await owner.mutation(api.reportProjects.invite, { id, token: invitation, role })
    await member.mutation(api.reportProjects.accept, { token: invitation })
    expect(await member.query(api.reports.get, { id })).toMatchObject({ role })
    expect(await member.query(api.reports.shared, { token })).not.toBeNull()
    expect(await member.query(api.runners.list)).toEqual([])
    expect(await member.query(api.runners.runs)).toEqual([])
    await expect(member.mutation(api.runners.enqueue, { runner, profileId: profile.id, digest: profile.digest, requestId: '7'.repeat(64) })).rejects.toThrow('not found')
    await expect(member.mutation(api.runners.setEnabled, { id: runner, enabled: false })).rejects.toThrow('not found')
    await expect(member.mutation(api.runners.revoke, { id: runner })).rejects.toThrow('not found')
    await expect(member.mutation(api.runners.cancel, { id: run })).rejects.toThrow('not found')
    await expect(member.query(api.runners.monitoring, { id: run, details: true })).rejects.toThrow('not found')
  }
  expect(await owner.query(api.runners.list)).toMatchObject([{ id: runner, revoked: false }])
})
test('server strips paths, configuration, logs and unknown row fields', async () => {
  const t = convexTest(schema, modules).withIdentity(identity)
  const dirty = { ...fixture, source: '/secret/path', config: { apiKey: 'secret' }, rows: [{ ...fixture.rows[0], error: 'secret stack trace', apiKey: 'secret', raw: { secret: true } }] }
  const id = await t.mutation(api.reports.save, { ...payload, json: JSON.stringify(dirty) })
  const saved = await t.query(api.reports.get, { id })
  expect(saved!.data).not.toContain('secret')
  expect(JSON.parse(saved!.data).rows[0].error).toBeNull()
})
test('rejects invalid/oversize imports without writing a report', async () => {
  const t = convexTest(schema, modules).withIdentity(identity)
  for (const value of [{}, { ...fixture, rows: [] }, { ...fixture, rows: [fixture.rows[0], fixture.rows[0]] }, { ...fixture, rows: [{ ...fixture.rows[0], reward: -1 }] }]) {
    await expect(t.mutation(api.reports.save, { ...payload, json: JSON.stringify(value) })).rejects.toThrow()
  }
  await expect(t.mutation(api.reports.save, { ...payload, json: ' '.repeat(750001) })).rejects.toThrow('750 KB')
  expect(await t.query(api.reports.list)).toEqual([])
  expect(() => parseReport('{')).toThrow()
})
test('workspace quota is enforced and lists exclude result data', async () => {
  const t = convexTest(schema, modules).withIdentity(identity)
  await t.run(async ctx => { for (let i = 0; i < 100; i++) await ctx.db.insert('reports', { owner: 'owner', title: 'Existing', trials: 1, shareToken: null }) })
  await expect(t.mutation(api.reports.save, payload)).rejects.toThrow('100-report limit')
  const list = await t.query(api.reports.list)
  expect(list).toHaveLength(100)
  expect(list[0]).not.toHaveProperty('data')
})

test('reports accept more than 500 unique trials within the document budget', async () => {
  const t = convexTest(schema, modules).withIdentity(identity)
  const rows = Array.from({length:600}, (_,i) => ({...fixture.rows[0],trial:`trial-${i}`}))
  const id = await t.mutation(api.reports.save, {...payload,json:JSON.stringify({...fixture,rows})})
  expect(JSON.parse((await t.query(api.reports.get,{id}))!.data).rows).toHaveLength(600)
})
