import { ConvexError, v } from 'convex/values'
import { query, mutation } from './_generated/server'
import { identity } from './reportAccess'
import { GUIDE_STEPS, type GuideProgress } from '../src/onboarding/model'

export const get = query({ args: {}, handler: async ctx => {
  const user = await identity(ctx)
  const saved = await ctx.db.query('onboardingProgress').withIndex('by_owner', q => q.eq('owner', user.subject)).unique()
  return saved ? { step: saved.step, status: saved.status } : null
} })

export const save = mutation({
  args: { step: v.number(), status: v.union(v.literal('started'), v.literal('completed'), v.literal('skipped')) },
  handler: async (ctx, input): Promise<GuideProgress> => {
    const user = await identity(ctx)
    if (!Number.isInteger(input.step) || input.step < 0 || input.step >= GUIDE_STEPS) throw new ConvexError('Unknown guide step.')
    if (input.status === 'completed' && input.step !== GUIDE_STEPS - 1) throw new ConvexError('Finish the guide before marking it complete.')
    const saved = await ctx.db.query('onboardingProgress').withIndex('by_owner', q => q.eq('owner', user.subject)).unique()
    // A stale tab must not bring back onboarding after another tab dismissed it.
    if (saved?.status === 'completed' || (saved?.status === 'skipped' && input.status !== 'completed')) return { step: saved.step, status: saved.status }
    const progress = { step: Math.max(saved?.step ?? 0, input.step), status: input.status }
    if (saved) await ctx.db.patch(saved._id, { ...progress, updatedAt: Date.now() })
    else await ctx.db.insert('onboardingProgress', { owner: user.subject, ...progress, updatedAt: Date.now() })
    return progress
  },
})
