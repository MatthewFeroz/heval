/**
 * Merge Gateway model catalog: fetch, cache, and query which vendors serve a model.
 *
 *   bun harbor/gateway/catalog.ts --refresh          # pull and cache the catalog
 *   bun harbor/gateway/catalog.ts glm-5.3            # vendors + pricing for matches
 *   bun harbor/gateway/catalog.ts --tools glm        # only tool-calling routes
 *
 * WHY. A model slug alone does not determine what you get. `zai/glm-5.3-flash`
 * is served by four vendors at a 10x price spread and a 6x throughput spread,
 * and the gateway's default pick is the slowest of them. Choosing a vendor is
 * therefore part of specifying an eval, and it has to be chosen against the
 * live catalog rather than a slug guessed from memory - vendors appear and
 * disappear per model.
 *
 * The cache is a plain JSON file so a job config can be validated offline and
 * the exact catalog a job was planned against can be committed alongside it.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import type { VendorRoute, CatalogModel } from '../../src/runners/gatewayCatalog'
export type { VendorRoute, CatalogModel } from '../../src/runners/gatewayCatalog'

export type Catalog = {
  schemaVersion: 1
  fetchedAt: string
  source: string
  models: CatalogModel[]
}

const CACHE = 'results/gateway/catalog.json'
const DEFAULT_BASE = 'https://api-gateway.merge.dev'

type Json = Record<string, unknown>
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

function normalize(raw: Json): CatalogModel {
  const vendors = (raw.vendors ?? {}) as Record<string, Json>
  return {
    model: String(raw.model),
    displayName: String(raw.display_name ?? raw.model),
    creator: String(raw.provider ?? String(raw.model).split('/')[0]),
    vendors: Object.entries(vendors).map(([vendor, info]) => {
      const caps = (info.capabilities ?? {}) as Json
      const price = (info.pricing ?? {}) as Json
      return {
        vendor,
        status: typeof info.availability_status === 'string' ? info.availability_status : null,
        contextWindow: num(info.context_window),
        maxOutputTokens: num(info.max_output_tokens),
        inputPerMillion: num(price.input_per_million),
        outputPerMillion: num(price.output_per_million),
        cacheReadPerMillion: num(price.cache_read_per_million),
        supportsToolCalling: caps.supports_tool_calling === true,
        supportsReasoning: caps.supports_reasoning === true,
      }
    }),
  }
}

/** Walks the cursor-paginated `/v1/models` endpoint to completion. */
export async function fetchCatalog(apiKey: string, base = DEFAULT_BASE): Promise<Catalog> {
  const models: CatalogModel[] = []
  let cursor: string | null = null
  for (let page = 0; page < 50; page++) {
    const url = new URL(`${base}/v1/models`)
    url.searchParams.set('limit', '200')
    if (cursor) url.searchParams.set('cursor', cursor)
    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(15000), redirect: 'error' })
    if (!res.ok) throw new Error(`catalog fetch failed: ${res.status}`)
    const body = (await res.json()) as { data?: Json[]; next_cursor?: string | null }
    for (const row of body.data ?? []) models.push(normalize(row))
    cursor = body.next_cursor ?? null
    if (!cursor) break
  }
  models.sort((a, b) => a.model.localeCompare(b.model))
  return { schemaVersion: 1, fetchedAt: new Date().toISOString(), source: base, models }
}

export function loadCatalog(path = CACHE): Catalog | null {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Catalog) : null
}

/** Vendors serving `model`, cheapest first. Empty when the model is unknown. */
export function vendorsFor(model: string, catalog: Catalog): VendorRoute[] {
  const hit = catalog.models.find((m) => m.model === model)
  if (!hit) return []
  return [...hit.vendors].sort((a, b) => (a.inputPerMillion ?? Infinity) - (b.inputPerMillion ?? Infinity))
}

/**
 * Validates a (model, vendor) pin against the catalog. Returns a human-readable
 * problem, or null when the pin is servable - the check a job config should run
 * before spending anything.
 */
export function checkPin(model: string, vendor: string, catalog: Catalog): string | null {
  const routes = vendorsFor(model, catalog)
  if (!routes.length) return `model '${model}' is not in the catalog`
  const hit = routes.find((r) => r.vendor === vendor)
  if (!hit) return `vendor '${vendor}' does not serve '${model}' (available: ${routes.map((r) => r.vendor).join(', ')})`
  if (hit.status && hit.status !== 'available') return `'${vendor}' serves '${model}' but is ${hit.status}`
  if (!hit.supportsToolCalling) return `'${vendor}/${model}' does not support tool calling and cannot drive a coding agent`
  return null
}

/**
 * Prices a trial's token counts against the catalog rate for one route.
 *
 * WHY THIS IS NEEDED. Harbor gets `cost_usd` two different ways. Claude Code
 * reports its own `total_cost_usd`, but Codex has no such field, so Harbor
 * prices it through LiteLLM's static table - which has never heard of
 * `zai/glm-5.3-flash` and leaves the cost null. That silently removes an entire
 * harness from every cost chart. The gateway already publishes exact per-route
 * rates, so we use those instead of teaching LiteLLM new slugs.
 *
 * `inputTokens` is Harbor's total prompt count and includes cache reads, so the
 * fresh portion is billed at the input rate and the remainder at the (cheaper)
 * cache-read rate when the route publishes one.
 */
export function priceTokens(
  tokens: { inputTokens: number | null; cacheTokens: number | null; outputTokens: number | null },
  route: VendorRoute,
): number | null {
  const { inputPerMillion, outputPerMillion } = route
  if (inputPerMillion === null || outputPerMillion === null) return null
  const input = tokens.inputTokens ?? 0
  const output = tokens.outputTokens ?? 0
  if (!input && !output) return null
  const cached = Math.min(tokens.cacheTokens ?? 0, input)
  const fresh = input - cached
  const cacheRate = route.cacheReadPerMillion ?? inputPerMillion
  return (fresh * inputPerMillion + cached * cacheRate + output * outputPerMillion) / 1e6
}

/** The catalog's rate card for one (model, vendor) pair, or null if unknown. */
export function routeFor(model: string, vendor: string | null, catalog: Catalog): VendorRoute | null {
  const routes = vendorsFor(model, catalog)
  if (!routes.length) return null
  // Without a pinned vendor there is no single correct rate; the cheapest route
  // would understate cost and the dearest would overstate it, so refuse.
  if (vendor === null) return null
  return routes.find((r) => r.vendor === vendor) ?? null
}

// -- cli ------------------------------------------------------------------------------

if (import.meta.main) {
  const args = process.argv.slice(2)
  const toolsOnly = args.includes('--tools')
  const refresh = args.includes('--refresh')
  const query = args.find((a) => !a.startsWith('--'))

  let catalog = loadCatalog()
  if (refresh || !catalog) {
    const key = process.env.HEVAL_GATEWAY_API_KEY
      ?? (existsSync('.env.local') ? readFileSync('.env.local', 'utf8').match(/^HEVAL_GATEWAY_API_KEY=(.*)$/m)?.[1]?.trim() : undefined)
    if (!key) {
      console.error('no HEVAL_GATEWAY_API_KEY in env or .env.local')
      process.exit(2)
    }
    catalog = await fetchCatalog(key)
    mkdirSync(dirname(CACHE), { recursive: true })
    writeFileSync(CACHE, JSON.stringify(catalog, null, 2))
    console.log(`${catalog.models.length} models -> ${CACHE}\n`)
  }

  const matches = query ? catalog.models.filter((m) => m.model.includes(query) || m.displayName.toLowerCase().includes(query.toLowerCase())) : []
  if (query && !matches.length) {
    console.error(`no model matching '${query}'`)
    process.exit(1)
  }
  if (!query) {
    console.log(`catalog fetched ${catalog.fetchedAt.slice(0, 19)}Z - ${catalog.models.length} models`)
    console.log('pass a model substring to list its vendors, e.g. `bun harbor/gateway/catalog.ts glm-5.3`')
    process.exit(0)
  }

  const usd = (n: number | null) => (n === null ? '?' : `$${n}`)
  for (const m of matches) {
    console.log(`\n${m.model}  (${m.displayName})`)
    const routes = [...m.vendors]
      .filter((r) => !toolsOnly || r.supportsToolCalling)
      .sort((a, b) => (a.inputPerMillion ?? Infinity) - (b.inputPerMillion ?? Infinity))
    if (!routes.length) { console.log('   (no routes match)'); continue }
    for (const r of routes) {
      const flags = [r.supportsToolCalling ? 'tools' : 'NO-TOOLS', r.supportsReasoning ? 'reasoning' : null].filter(Boolean).join(' ')
      console.log(`   ${r.vendor.padEnd(14)} ${usd(r.inputPerMillion)}/${usd(r.outputPerMillion)} per Mtok`.padEnd(48) + `${r.status ?? '?'}  ctx=${r.contextWindow ?? '?'}  ${flags}`)
    }
  }
}
