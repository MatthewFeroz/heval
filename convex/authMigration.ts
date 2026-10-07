import { internalMutation } from './_generated/server'
import { v, ConvexError } from 'convex/values'

// Operator-only mapping after both account identities have been verified.
// Preserve existing ownership and worker credentials without rewriting data.
export const linkLegacyAccount = internalMutation({
  args: { clerkSubject: v.string(), legacySubject: v.string() },
  handler: async (ctx, { clerkSubject, legacySubject }) => {
    const issuer = process.env.CLERK_JWT_ISSUER_DOMAIN
    if (!issuer || !clerkSubject.startsWith('user_') || !legacySubject.trim() || clerkSubject === legacySubject) throw new ConvexError('Supply the configured Clerk issuer and two verified, distinct account IDs.')
    const existing = await ctx.db.query('authAccountLinks').withIndex('by_identity', q => q.eq('issuer', issuer).eq('subject', clerkSubject)).unique()
    if (existing) {
      if (existing.owner !== legacySubject) throw new ConvexError('This Clerk account is already linked to a different owner.')
      return existing._id
    }
    if (await ctx.db.query('authAccountLinks').withIndex('by_owner', q => q.eq('owner', legacySubject)).first()) throw new ConvexError('This owner already has a linked account.')
    // Link before a Clerk user starts creating data: otherwise the user's new
    // workspace would become unreachable. Do not silently combine accounts.
    for (const table of ['reports', 'runners', 'runnerRuns', 'runnerPairings', 'experiments', 'onboardingProgress', 'presentationExports'] as const) {
      if (await ctx.db.query(table).withIndex('by_owner', q => q.eq('owner', clerkSubject)).first()) throw new ConvexError('The Clerk account already has workspace data. Resolve its ownership before linking.')
    }
    if (await ctx.db.query('reportMembers').withIndex('by_user', q => q.eq('user', clerkSubject)).first()) throw new ConvexError('The Clerk account already has report memberships.')
    return await ctx.db.insert('authAccountLinks', { issuer, subject: clerkSubject, owner: legacySubject })
  },
})
