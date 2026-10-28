/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { expect, test } from 'vitest'
import schema from './schema'
import { api } from './_generated/api'
import fixture from '../results/harbor/demo-evaluation.json'
const modules = import.meta.glob(['./**/*.ts', './**/*.js', '!./**/*.test.ts'])
test('evidence is private until explicitly reviewed, and report revocation stops public reads', async () => {
  const t = convexTest(schema, modules), owner = t.withIdentity({ subject: 'owner' }), stranger = t.withIdentity({ subject: 'stranger' })
  const report = await owner.mutation(api.reports.save, { json: JSON.stringify(fixture), title: 'Synthetic evidence demonstration' })
  const args = { report, trial: fixture.rows[0].trial, title: 'Demonstration patch', kind: 'patch' as const, text: '+ synthetic demonstration content' }
  const id = await owner.mutation(api.reportEvidence.add, args)
  expect(await owner.mutation(api.reportEvidence.add, args)).toBe(id)
  await expect(stranger.mutation(api.reportEvidence.add, args)).rejects.toThrow('not found')
  await expect(owner.mutation(api.reportEvidence.add, { ...args, trial: 'missing' })).rejects.toThrow('actual trial')
  await expect(owner.mutation(api.reportEvidence.add, { ...args, text: 'x'.repeat(16_001) })).rejects.toThrow('16 KB')
  const token = 'a'.repeat(64)
  await owner.mutation(api.reports.share, { id: report, token })
  expect((await t.query(api.reports.shared, { token }))!.evidence).toEqual([])
  await expect(owner.mutation(api.reportEvidence.setPublished, { id, published: true, reviewed: false })).rejects.toThrow('Review')
  await expect(stranger.mutation(api.reportEvidence.setPublished, { id, published: true, reviewed: true })).rejects.toThrow('not found')
  const before = (await owner.query(api.reports.get, { id: report }))!.data
  await owner.mutation(api.reportEvidence.setPublished, { id, published: true, reviewed: true })
  expect((await t.query(api.reports.shared, { token }))!.evidence[0].text).toBe(args.text)
  const second = await owner.mutation(api.reportEvidence.add, { ...args, text: 'A later private draft' })
  expect((await t.query(api.reports.shared, { token }))!.evidence).toHaveLength(1)
  await owner.mutation(api.reportEvidence.setPublished, { id, published: false, reviewed: false })
  expect((await t.query(api.reports.shared, { token }))!.evidence).toEqual([])
  await owner.mutation(api.reportEvidence.setPublished, { id: second, published: true, reviewed: true })
  await owner.mutation(api.reports.revoke, { id: report })
  expect(await t.query(api.reports.shared, { token })).toBeNull()
  expect((await owner.query(api.reports.get, { id: report }))!.data).toBe(before)
})
