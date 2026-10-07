/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, expect, test, vi } from 'vitest'
import schema from './schema'
import { api, internal } from './_generated/api'
const modules = import.meta.glob(['./**/*.ts', './**/*.js', '!./**/*.test.ts'])
const issuer = 'https://example.clerk.accounts.dev'
afterEach(() => vi.unstubAllEnvs())

test('a verified Clerk account inherits legacy reports, workers, membership and progress without changing stored ownership', async () => {
  vi.stubEnv('CLERK_JWT_ISSUER_DOMAIN', issuer)
  const t = convexTest(schema, modules)
  const ids = await t.run(async ctx => {
    const report = await ctx.db.insert('reports', { owner: 'legacy', title: 'Existing results', trials: 1, shareToken: null })
    const shared = await ctx.db.insert('reports', { owner: 'teammate', title: 'Team report', trials: 1, shareToken: null })
    await ctx.db.insert('reportMembers', { report: shared, user: 'legacy', label: 'Legacy account', role: 'editor' })
    await ctx.db.insert('runners', { owner: 'legacy', name: 'Existing worker', credentialHash: 'existing-credential', revoked: false, lastSeen: Date.now(), ready: true, health: '', profiles: [], leaseUntil: 0 })
    await ctx.db.insert('onboardingProgress', { owner: 'legacy', step: 2, status: 'started', updatedAt: Date.now() })
    return { report, shared }
  })
  const clerk = t.withIdentity({ issuer, subject: 'user_clerk' })
  expect(await clerk.query(api.reports.list, {})).toHaveLength(0)
  const link = await t.mutation(internal.authMigration.linkLegacyAccount, { clerkSubject: 'user_clerk', legacySubject: 'legacy' })
  expect(await t.mutation(internal.authMigration.linkLegacyAccount, { clerkSubject: 'user_clerk', legacySubject: 'legacy' })).toBe(link)
  expect(await clerk.query(api.onboarding.get, {})).toEqual({ step: 2, status: 'started' })
  expect((await clerk.query(api.runners.list, {}))[0].name).toBe('Existing worker')
  expect((await clerk.query(api.reports.list, {})).map(r => r.id)).toEqual(expect.arrayContaining([ids.report, ids.shared]))
  await clerk.mutation(api.reports.revoke, { id: ids.report })
  await expect(t.withIdentity({ issuer, subject: 'user_other' }).mutation(api.reports.revoke, { id: ids.report })).rejects.toThrow()
  await expect(t.withIdentity({ issuer: 'https://other.example.com', subject: 'user_clerk' }).mutation(api.reports.revoke, { id: ids.report })).rejects.toThrow()
  expect(await t.run(async ctx => (await ctx.db.get(ids.report))?.owner)).toBe('legacy')
  expect(await t.run(async ctx => (await ctx.db.query('runners').first())?.credentialHash)).toBe('existing-credential')
})

test('mapping rejects duplicate owners, reassignment and accounts with new data', async () => {
  vi.stubEnv('CLERK_JWT_ISSUER_DOMAIN', issuer)
  const t = convexTest(schema, modules)
  await t.mutation(internal.authMigration.linkLegacyAccount, { clerkSubject: 'user_a', legacySubject: 'legacy' })
  await expect(t.mutation(internal.authMigration.linkLegacyAccount, { clerkSubject: 'user_b', legacySubject: 'legacy' })).rejects.toThrow('already has')
  await expect(t.mutation(internal.authMigration.linkLegacyAccount, { clerkSubject: 'user_a', legacySubject: 'another' })).rejects.toThrow('different owner')
  await t.withIdentity({ issuer, subject: 'user_new' }).mutation(api.onboarding.save, { step: 1, status: 'started' })
  await expect(t.mutation(internal.authMigration.linkLegacyAccount, { clerkSubject: 'user_new', legacySubject: 'another' })).rejects.toThrow('already has workspace data')
})
