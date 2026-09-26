/** Safe, public rate-card metadata. Credentials never cross the worker boundary. */
export type VendorRoute = {
  vendor: string; status: string | null; contextWindow: number | null; maxOutputTokens: number | null
  inputPerMillion: number | null; outputPerMillion: number | null; cacheReadPerMillion: number | null
  supportsToolCalling: boolean; supportsReasoning: boolean
}
export type CatalogModel = { model: string; displayName: string; creator: string; vendors: VendorRoute[] }
export type GatewayCatalog = { fetchedAt: string; models: CatalogModel[] }
