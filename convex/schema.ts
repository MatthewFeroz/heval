import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  reports: defineTable({
    owner: v.string(), title: v.string(), trials: v.number(),
    shareToken: v.union(v.string(), v.null()),
  }).index('by_owner', ['owner']).index('by_share', ['shareToken']),
  reportData: defineTable({ report: v.id('reports'), json: v.string() }).index('by_report', ['report']),
  usedShareTokens: defineTable({ token: v.string() }).index('by_token', ['token']),
})
