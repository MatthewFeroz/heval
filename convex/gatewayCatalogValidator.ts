import { v } from 'convex/values'
const nullableNumber = v.union(v.number(), v.null()), nullableString = v.union(v.string(), v.null())
export const gatewayCatalogValidator = v.union(v.null(), v.object({
  fetchedAt: v.string(), models: v.array(v.object({ model: v.string(), displayName: v.string(), creator: v.string(), vendors: v.array(v.object({
    vendor: v.string(), status: nullableString, contextWindow: nullableNumber, maxOutputTokens: nullableNumber,
    inputPerMillion: nullableNumber, outputPerMillion: nullableNumber, cacheReadPerMillion: nullableNumber,
    supportsToolCalling: v.boolean(), supportsReasoning: v.boolean(),
  })) })),
}))
