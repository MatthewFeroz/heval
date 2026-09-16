/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { expect, test } from 'vitest'
import schema from './schema'
import { api } from './_generated/api'

const modules = import.meta.glob(['./**/*.ts', './**/*.js', '!./**/*.test.ts'])
const alice = { subject: 'alice', issuer: 'https://api.workos.com/' }
const bob = { subject: 'bob', issuer: 'https://api.workos.com/' }

test('first visit, resume from another session, and account isolation', async () => {
  const t = convexTest(schema, modules)
  const owner = t.withIdentity(alice)
  expect(await owner.query(api.onboarding.get, {})).toBeNull()
  await owner.mutation(api.onboarding.save, { step: 1, status: 'started' })
  expect(await t.withIdentity(alice).query(api.onboarding.get, {})).toEqual({ step: 1, status: 'started' })
  expect(await t.withIdentity(bob).query(api.onboarding.get, {})).toBeNull()
  await t.withIdentity(bob).mutation(api.onboarding.save, { step: 0, status: 'skipped' })
  expect(await owner.query(api.onboarding.get, {})).toEqual({ step: 1, status: 'started' })
})

test('skip and completion persist; stale tabs never restart onboarding', async () => {
  const t = convexTest(schema, modules).withIdentity(alice)
  await t.mutation(api.onboarding.save, { step: 1, status: 'skipped' })
  expect(await t.mutation(api.onboarding.save, { step: 2, status: 'started' })).toEqual({ step: 1, status: 'skipped' })
  // The guide may be opened manually and finished after it was skipped.
  await t.mutation(api.onboarding.save, { step: 3, status: 'completed' })
  await t.mutation(api.onboarding.save, { step: 1, status: 'started' })
  await t.mutation(api.onboarding.save, { step: 0, status: 'skipped' })
  expect(await t.query(api.onboarding.get, {})).toEqual({ step: 3, status: 'completed' })
})

test('progress is monotonic and repeated writes reuse one account record', async () => {
  const t = convexTest(schema, modules).withIdentity(alice)
  await t.mutation(api.onboarding.save, { step: 2, status: 'started' })
  await t.mutation(api.onboarding.save, { step: 1, status: 'started' })
  expect(await t.query(api.onboarding.get, {})).toEqual({ step: 2, status: 'started' })
  expect(await t.run(ctx => ctx.db.query('onboardingProgress').collect())).toHaveLength(1)
})

test('anonymous callers and invalid transitions are rejected', async () => {
  const t = convexTest(schema, modules)
  await expect(t.query(api.onboarding.get, {})).rejects.toThrow('Sign in')
  await expect(t.mutation(api.onboarding.save, { step: 0, status: 'skipped' })).rejects.toThrow('Sign in')
  const owner = t.withIdentity(alice)
  for (const step of [-1, 0.5, 4]) await expect(owner.mutation(api.onboarding.save, { step, status: 'started' })).rejects.toThrow('Unknown guide step')
  await expect(owner.mutation(api.onboarding.save, { step: 1, status: 'completed' })).rejects.toThrow('Finish the guide')
  expect(await owner.query(api.onboarding.get, {})).toBeNull()
})
