/**
 * Vendor-pinning reverse proxy for Merge Gateway.
 *
 *   bun harbor/proxy/vendor-proxy.ts --pins harbor/proxy/pins.json
 *   bun harbor/proxy/vendor-proxy.ts --vendor particle          # single-model runs
 *
 * WHY THIS EXISTS. Merge Gateway picks which vendor serves a model unless the
 * request names one, and the default is not the fastest: measured 2026-09-02 on
 * `zai/glm-5.3-flash`, unpinned traffic went to `zai` at ~36 tok/s while
 * `particle` served the same model at ~184 tok/s for the same price. An eval
 * that does not pin is therefore measuring vendor routing, not the model.
 *
 * The gateway only accepts the pin as a JSON body field (`vendor`). Request
 * headers are ignored - `x-merge-vendor` and `x-vendor` were both probed and
 * silently dropped - and neither Codex nor Claude Code can inject an arbitrary
 * body field. So the pin has to happen in the request path, which is this.
 *
 * WHY PER-MODEL PINS. A sweep varies the model, and no single vendor serves
 * every model in one: `particle` serves glm-5.3-flash and deepseek-v4-flash but
 * not glm-5.3 or kimi-k3. A global `--vendor` would silently fail to apply on
 * the models it does not serve, which is the unpinned bug wearing a hat. Pass a
 * pins file for a sweep; `--vendor` remains for single-model runs.
 *
 * Point the harness at it instead of the gateway:
 *
 *   OPENAI_BASE_URL:    http://host.docker.internal:8787/v1/openai
 *   ANTHROPIC_BASE_URL: http://host.docker.internal:8787/v1/anthropic
 *
 * Every request is logged as JSONL with the vendor the gateway reports having
 * actually served (`x-merge-vendor`), so the pin is auditable after the fact
 * rather than assumed - docs/first-eval.md requires provenance, not intent.
 * A served vendor that disagrees with the pin is counted and reported on exit.
 */

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}

const DEFAULT_VENDOR = arg('vendor', process.env.HEVAL_VENDOR)
const PINS_FILE = arg('pins', process.env.HEVAL_VENDOR_PINS)
const UPSTREAM = (arg('upstream', process.env.HEVAL_GATEWAY_URL) ?? 'https://api-gateway.merge.dev').replace(/\/$/, '')
const PORT = Number(arg('port', process.env.PORT ?? '8787'))
const LOG = arg('log', process.env.HEVAL_PROXY_LOG ?? 'results/proxy/vendor-proxy.jsonl')!

/**
 * Harbor's codex agent sends the bare model name, not the catalog slug: it
 * calls `model_name.split("/")[-1]` before invoking the CLI. The pins file is
 * written with full slugs so it can be diffed against the catalog, so both
 * sides are reduced to the bare name before lookup.
 */
const bare = (model: string) => model.split('/').pop()!.toLowerCase()

const pins = new Map<string, string>()
if (PINS_FILE) {
  const parsed = JSON.parse(readFileSync(PINS_FILE, 'utf8')) as Record<string, string>
  for (const [model, vendor] of Object.entries(parsed)) pins.set(bare(model), vendor)
}

if (!pins.size && !DEFAULT_VENDOR) {
  console.error('usage: bun harbor/proxy/vendor-proxy.ts (--pins FILE | --vendor NAME) [--upstream URL] [--port 8787] [--log PATH]')
  console.error('a pin is required; running unpinned is the bug this proxy exists to prevent')
  process.exit(2)
}

mkdirSync(dirname(LOG), { recursive: true })

/** Endpoints that take a model in the body and therefore accept a vendor pin. */
const PINNABLE = /\/(chat\/completions|completions|responses|messages|embeddings)$/

const stats = { total: 0, pinned: 0, unpinned: 0, mismatched: 0, errors: 0 }
const served = new Map<string, number>()
/** Models seen with no pin, so a sweep reports its own gaps instead of hiding them. */
const unpinnedModels = new Set<string>()

function log(entry: Record<string, unknown>) {
  appendFileSync(LOG, `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`)
}

const server = Bun.serve({
  port: PORT,
  hostname: '0.0.0.0',
  // Agent turns on a reasoning model can exceed the default; a proxy timeout
  // would surface as a harness error and be misread as a model failure.
  idleTimeout: 255,
  async fetch(req) {
    const url = new URL(req.url)
    const target = `${UPSTREAM}${url.pathname}${url.search}`
    const started = Date.now()
    stats.total++

    const headers = new Headers(req.headers)
    // Rewritten below if we re-serialize; the upstream host must not be ours.
    headers.delete('host')
    headers.delete('content-length')

    let body: BodyInit | null = null
    let model: unknown = null
    let pin: string | null = null

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const raw = await req.text()
      if (PINNABLE.test(url.pathname) && raw) {
        try {
          const parsed = JSON.parse(raw) as Record<string, unknown>
          model = parsed.model
          // An explicit vendor from the caller wins; this proxy sets a default,
          // it does not override a deliberate choice.
          if (parsed.vendor === undefined && typeof model === 'string') {
            pin = pins.get(bare(model)) ?? DEFAULT_VENDOR ?? null
            if (pin) {
              parsed.vendor = pin
              stats.pinned++
            } else {
              stats.unpinned++
              unpinnedModels.add(model)
            }
          }
          body = JSON.stringify(parsed)
        } catch {
          // Not JSON we understand - forward untouched rather than corrupt it.
          body = raw
        }
      } else {
        body = raw
      }
    }

    try {
      const res = await fetch(target, { method: req.method, headers, body, redirect: 'manual' })
      const servedVendor = res.headers.get('x-merge-vendor')
      if (servedVendor) served.set(servedVendor, (served.get(servedVendor) ?? 0) + 1)
      const mismatch = pin !== null && servedVendor !== null && servedVendor !== pin
      if (mismatch) stats.mismatched++

      log({
        path: url.pathname, status: res.status, ms: Date.now() - started,
        model, pinned: pin, served: servedVendor,
        ...(mismatch ? { mismatch: true } : {}),
      })
      if (mismatch) console.warn(`  ! pinned ${pin} but gateway served ${servedVendor} (${String(model)})`)
      if (pin === null && typeof model === 'string') console.warn(`  ! no vendor pin for ${model}; the gateway chose the route`)

      // Returned as-is so SSE streams through unbuffered; both harnesses stream,
      // and buffering here would distort the very latency we are measuring.
      return new Response(res.body, { status: res.status, headers: res.headers })
    } catch (err) {
      stats.errors++
      const message = err instanceof Error ? err.message : String(err)
      log({ path: url.pathname, error: message, ms: Date.now() - started, model })
      return Response.json({ error: { type: 'proxy_error', message, source: 'heval-vendor-proxy' } }, { status: 502 })
    }
  },
})

const describePins = pins.size ? [...pins].map(([m, v]) => `${m}->${v}`).join(' ') : `(all)->${DEFAULT_VENDOR}`
console.log(`vendor-proxy  upstream=${UPSTREAM}`)
console.log(`  pins        ${describePins}${pins.size && DEFAULT_VENDOR ? `  default=${DEFAULT_VENDOR}` : ''}`)
console.log(`  listening   http://localhost:${server.port}  (containers: http://host.docker.internal:${server.port})`)
console.log(`  log         ${LOG}`)

function summarize() {
  const breakdown = [...served.entries()].sort((a, b) => b[1] - a[1]).map(([v, n]) => `${v}=${n}`).join(' ') || 'none reported'
  console.log(`\n${stats.total} requests  ${stats.pinned} pinned  ${stats.unpinned} unpinned  ${stats.errors} errors`)
  console.log(`served by: ${breakdown}`)
  if (stats.unpinned) console.log(`WARNING: ${stats.unpinned} requests had no pin (${[...unpinnedModels].join(', ')}); those routes were the gateway's choice`)
  if (stats.mismatched) console.log(`WARNING: ${stats.mismatched} requests were served by a vendor other than the one pinned`)
  process.exit(0)
}
process.on('SIGINT', summarize)
process.on('SIGTERM', summarize)
