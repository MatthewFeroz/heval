import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  reports: defineTable({
    owner: v.string(), title: v.string(), trials: v.number(),
    shareToken: v.union(v.string(), v.null()),
  }).index('by_owner', ['owner']).index('by_share', ['shareToken']),
  reportData: defineTable({ report: v.id('reports'), json: v.string() }).index('by_report', ['report']),
  usedShareTokens: defineTable({ token: v.string() }).index('by_token', ['token']),
  reportProjects: defineTable({ report: v.id('reports'), draft: v.string(), version: v.number(), updatedBy: v.string(), published: v.optional(v.string()), publishedVersion: v.optional(v.number()) }).index('by_report', ['report']),
  reportRevisions: defineTable({ report: v.id('reports'), version: v.number(), document: v.string(), publishedBy: v.string() }).index('by_report', ['report', 'version']),
  reportMembers: defineTable({ report: v.id('reports'), user: v.string(), label: v.string(), role: v.union(v.literal('viewer'), v.literal('editor')) }).index('by_user', ['user']).index('by_report', ['report', 'user']),
  reportInvites: defineTable({ report: v.id('reports'), token: v.string(), role: v.union(v.literal('viewer'), v.literal('editor')), expiresAt: v.number(), usedBy: v.optional(v.string()), revoked: v.boolean() }).index('by_token', ['token']).index('by_report', ['report']),
})
