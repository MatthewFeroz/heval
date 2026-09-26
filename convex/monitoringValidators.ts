import { v } from 'convex/values'

const state = v.union(v.literal('running'), v.literal('passed'), v.literal('failed'), v.literal('error'))
export const monitoringValidator = v.object({
  sequence: v.number(), sampledAt: v.number(),
  trials: v.array(v.object({ id: v.string(), state, startedAt: v.number(), updatedAt: v.number(), finishedAt: v.optional(v.number()) })),
  events: v.array(v.object({ sequence: v.number(), at: v.number(), trial: v.string(), state })),
})
