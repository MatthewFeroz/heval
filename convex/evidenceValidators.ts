import { v } from 'convex/values'
export const evidenceKindValidator = v.union(v.literal('patch'), v.literal('verifier'), v.literal('timeline'), v.literal('html'), v.literal('image'))
export const evidenceInputValidator = v.object({ trial: v.string(), title: v.string(), kind: evidenceKindValidator, text: v.string() })
