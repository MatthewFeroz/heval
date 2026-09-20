import { v } from 'convex/values'
export const profileValidator = v.object({ id: v.string(), digest: v.string(), title: v.string(), benchmark: v.string(), agent: v.string(), model: v.string(), tasks: v.number(), attempts: v.number(), timeoutSeconds: v.number(), setupCheck: v.boolean(), taskSet: v.optional(v.string()), vendor: v.optional(v.string()), maxAttempts: v.optional(v.number()) })
export const runStatusValidator = v.union(v.literal('queued'), v.literal('running'), v.literal('cancelling'), v.literal('completed'), v.literal('failed'), v.literal('cancelled'), v.literal('interrupted'))
