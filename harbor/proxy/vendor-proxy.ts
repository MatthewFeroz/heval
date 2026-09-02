/**
 * Vendor-pinning reverse proxy for Merge Gateway.
 *
 *   bun harbor/proxy/vendor-proxy.ts --vendor particle
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

import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}

const VENDOR = arg('vendor', process.env.HEVAL_VENDOR)
const UPSTREAM = (arg('upstream', process.env.HEVAL_GATEWAY_URL) ?? 'https://api-gateway.merge.dev').replace(/\/$/, '')
const PORT = Number(arg('port', process.env.PORT ?? '8787'))
const LOG = arg('log', process.env.HEVAL_PROXY_LOG ?? 'results/proxy/vendor-proxy.jsonl')!

if (!VENDOR) {
  console.error('usage: bun harbor/proxy/vendor-proxy.ts --vendor <name> [--upstream URL] [--port 8787] [--log PATH]')
  console.error('a vendor is required; running unpinned is the bug this proxy exists to prevent')
  process.exit(2)
}

mkdirSync(dirname(LOG), { recursive: true })

/** Endpoints that take a model in the body and therefore accept a vendor pin. */
const PINNABLE = /\/(chat\/completions|completions|responses|messages|embeddings)$/

const stats = { total: 0, pinned: 0, mismatched: 0, errors: 0 }
const served = new Map<string, number>()

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
    let didPin = false

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const raw = await req.text()
      if (PINNABLE.test(url.pathname) && raw) {
        try {
          const parsed = JSON.parse(raw) as Record<string, unknown>
          model = parsed.model
          // An explicit vendor from the caller wins; this proxy sets a default,
          // it does not override a deliberate choice.
          if (parsed.vendor === undefined) {
            parsed.vendor = VENDOR
            didPin = true
            stats.pinned++
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
      const mismatch = didPin && servedVendor !== null && servedVendor !== VENDOR
      if (mismatch) stats.mismatched++

      log({
        path: url.pathname, status: res.status, ms: Date.now() - started,
        model, pinned: didPin ? VENDOR : null, served: servedVendor,
        ...(mismatch ? { mismatch: true } : {}),
      })
      if (mismatch) console.warn(`  ! pinned ${VENDOR} but gateway served ${servedVendor} (${String(model)})`)

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

console.log(`vendor-proxy  pin=${VENDOR}  upstream=${UPSTREAM}`)
console.log(`  listening   http://localhost:${server.port}  (containers: http://host.docker.internal:${server.port})`)
console.log(`  log         ${LOG}`)

function summarize() {
  const breakdown = [...served.entries()].sort((a, b) => b[1] - a[1]).map(([v, n]) => `${v}=${n}`).join(' ') || 'none reported'
  console.log(`\n${stats.total} requests  ${stats.pinned} pinned  ${stats.errors} errors`)
  console.log(`served by: ${breakdown}`)
  if (stats.mismatched) console.log(`WARNING: ${stats.mismatched} requests were served by a vendor other than ${VENDOR}`)
  process.exit(0)
}
process.on('SIGINT', summarize)
process.on('SIGTERM', summarize)
