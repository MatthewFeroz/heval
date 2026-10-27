import { v } from 'convex/values'
export const managedSpecValidator = v.object({ goal: v.union(v.literal('harnesses'), v.literal('models')), harnesses: v.array(v.string()), models: v.array(v.string()), budgetUsd: v.number(), minutes: v.number() })
export const managedStatusValidator = v.union(v.literal('queued'), v.literal('provisioning'), v.literal('running'), v.literal('stopping'), v.literal('cleanup'), v.literal('completed'), v.literal('failed'), v.literal('cancelled'))
