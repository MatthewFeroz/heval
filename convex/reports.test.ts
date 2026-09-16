/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { expect, test } from 'vitest'
import schema from './schema'
import { api } from './_generated/api'
import fixture from '../results/harbor/terminal-bench-comparison.json'
import { parseReport } from '../src/reports/format'

const modules = import.meta.glob(['./**/*.ts', './**/*.js', '!./**/*.test.ts'])
const payload = { json: JSON.stringify(fixture), title: 'Setup check' }
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
  for (const value of [{}, { ...fixture, rows: [] }, { ...fixture, rows: [fixture.rows[0], fixture.rows[0]] }, { ...fixture, rows: [{ ...fixture.rows[0], reward: -1 }] }, { ...fixture, rows: Array(501).fill(fixture.rows[0]) }]) {
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
