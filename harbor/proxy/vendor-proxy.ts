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
 * rather than assumed - record observed routing as provenance.
 * A served vendor that disagrees with the pin is counted and reported on exit.
 *
 * --thinking-as-effort drops `thinking: {type: "enabled"}` from requests that
 * also carry `reasoning_effort`. DeepSeek Harness sends both, and the gateway
 * currently rejects that pair on DeepSeek V4.1 Flash with capability_unavailable
 * although `reasoning_effort` alone routes and returns thinking. Remove it once
 * the gateway translates that pair itself. Each rewritten request is logged
 * with `rewrote`, so it is disclosed, not silent.
 *
 * --reject-hosted-tools answers any request that declares a provider-hosted tool
 * (web search/fetch, code execution, file search, computer use, remote MCP) with
 * HTTP 400 instead of forwarding it, as HarnessTax did for SWE-bench Lite: such
 * tools run outside the task container's network policy. Function and custom
 * tools, which the harness executes locally, pass. Rejections are logged.
 *
 * --only-model <slug> answers requests for any other model with HTTP 403, and
 * rejects a caller-supplied vendor that differs from the pin. Agents inside the
 * task container can reach the proxy and read the harness's API key, and were
 * seen curling it to consult other models (Claude, GPT, Gemini) mid-task.
 *
 * USAGE. Model responses pass through unchanged: the harness gets the stream
 * unbuffered, and the proxy reads the usage block the gateway returns (tokens and
 * billed `cost`) and logs it with the request once the response ends. That is
 * a harness-neutral cost for every harness, including ones that report none
 * themselves and ones (Claude Code) that price a non-Claude model at Claude rates.
 *
 * SPEND LIMIT. The gateway omits `cost` on Anthropic Messages responses, so
 * --rates FILE ({"<model slug>": {input, cacheRead, cacheWrite?, output}} per
 * million tokens) prices each logged response as `estCostUsd`. Uncached input
 * is priced at the higher of the input and cache-write rates, so the estimate
 * errs high. --budget-usd N refuses model requests with HTTP 402 once the
 * estimates in every *.jsonl under --spend-dir (default: this log's directory)
 * reach N, so proxies for different models in one run share one limit.
 * Requests already in flight finish, so a run can overshoot by its last turn.
 */

import { appendFileSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}

const DEFAULT_VENDOR = arg('vendor', process.env.HEVAL_VENDOR)
const PINS_FILE = arg('pins', process.env.HEVAL_VENDOR_PINS)
const UPSTREAM = (arg('upstream', process.env.HEVAL_GATEWAY_URL) ?? 'https://api-gateway.merge.dev').replace(/\/$/, '')
const PORT = Number(arg('port', process.env.PORT ?? '8787'))
const LOG = arg('log', process.env.HEVAL_PROXY_LOG ?? 'results/proxy/vendor-proxy.jsonl')!
const THINKING_AS_EFFORT = process.argv.includes('--thinking-as-effort')
const REJECT_HOSTED_TOOLS = process.argv.includes('--reject-hosted-tools')
const ONLY_MODEL = arg('only-model')
const RATES_FILE = arg('rates')
const BUDGET_USD = arg('budget-usd') === undefined ? null : Number(arg('budget-usd'))
const SPEND_DIR = arg('spend-dir', dirname(LOG))!

/** Provider-executed tool types (OpenAI Responses/chat, Anthropic server tools). */
const HOSTED_TOOL = /web_search|web_fetch|file_search|code_interpreter|code_execution|computer|image_generation|^mcp$|google_search|url_context/

/** Declared tool types that the provider, not the harness, would execute. */
export function hostedTools(body: Record<string, unknown>): string[] {
  const tools = Array.isArray(body.tools) ? body.tools : []
  return tools.flatMap(t => {
    const type = t && typeof t === 'object' ? (t as Record<string, unknown>).type : undefined
    return typeof type === 'string' && HOSTED_TOOL.test(type) ? [type] : []
  })
}

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

export type Usage = { inputTokens: number | null; outputTokens: number | null; cachedTokens: number | null; costUsd: number | null }

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null)
const obj = (v: unknown) => (v && typeof v === 'object' ? (v as Record<string, unknown>) : null)

/**
 * Folds one parsed response event into the running usage. Covers OpenAI chat
 * (`usage` on the final chunk), Responses (`response.usage`) and Anthropic
 * Messages (`message.usage` on message_start, cumulative `usage` on
 * message_delta). Later values win: streams report running totals.
 */
export function foldUsage(acc: Usage, event: unknown): Usage {
  const e = obj(event)
  if (!e) return acc
  const usage = obj(e.usage) ?? obj(obj(e.response)?.usage) ?? obj(obj(e.message)?.usage)
  if (!usage) return acc
  const details = obj(usage.prompt_tokens_details) ?? obj(usage.input_tokens_details)
  // Anthropic's input_tokens excludes cache reads and writes; OpenAI's includes them.
  // Report total input either way, so cached tokens are always a subset of it.
  const anthropicInput = num(usage.input_tokens) !== null && 'cache_read_input_tokens' in usage
    ? num(usage.input_tokens)! + (num(usage.cache_read_input_tokens) ?? 0) + (num(usage.cache_creation_input_tokens) ?? 0)
    : null
  return {
    inputTokens: num(usage.prompt_tokens) ?? anthropicInput ?? num(usage.input_tokens) ?? acc.inputTokens,
    outputTokens: num(usage.completion_tokens) ?? num(usage.output_tokens) ?? acc.outputTokens,
    cachedTokens: num(details?.cached_tokens) ?? num(usage.cache_read_input_tokens) ?? acc.cachedTokens,
    costUsd: num(usage.cost) ?? acc.costUsd,
  }
}

/**
 * Passes a response body (SSE or JSON) through unchanged while collecting the
 * usage it reports, and calls `done` once with that usage, or with the error if
 * the upstream stream fails. A pass-through rather than `body.tee()`: under Bun,
 * an upstream reset mid-stream errored both tee branches inside the runtime and
 * killed the proxy, and with it every trial routed through it.
 */
export function withUsage(body: ReadableStream<Uint8Array>, done: (usage: Usage | null, error?: string) => void, contentType = '') {
  const decoder = new TextDecoder()
  const json = contentType.includes('json')
  let acc: Usage = { inputTokens: null, outputTokens: null, cachedTokens: null, costUsd: null }
  // A non-streamed JSON body, including pretty-printed JSON, is parsed whole at the end.
  let carry = ''
  const consume = (line: string) => {
    const text = line.startsWith('data:') ? line.slice(5).trim() : line.trim()
    if (!text.includes('"usage"')) return
    try { acc = foldUsage(acc, JSON.parse(text)) } catch { /* partial or non-JSON line */ }
  }
  const usage = () => (Object.values(acc).some(v => v !== null) ? acc : null)
  let reported = false
  const report = (error?: string) => { if (!reported) { reported = true; done(usage(), error) } }
  const reader = body.getReader()
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read()
        if (next.done) {
          consume(carry + decoder.decode())
          report()
          controller.close()
          return
        }
        carry += decoder.decode(next.value, { stream: true })
        if (!json) {
          const lines = carry.split('\n')
          carry = lines.pop() ?? ''
          for (const line of lines) consume(line)
        }
        controller.enqueue(next.value)
      } catch (err) {
        consume(carry + decoder.decode())
        const message = err instanceof Error ? err.message : String(err)
        report(message)
        controller.error(err)
      }
    },
    async cancel(reason) {
      consume(carry + decoder.decode())
      try { report(`client closed: ${String(reason ?? 'cancelled')}`) }
      finally { await reader.cancel(reason).catch(() => {}) }
    },
  })
}

export type Rate = { input: number; cacheRead: number; cacheWrite?: number; output: number }

/** Estimated cost of one response in USD, erring high: uncached input pays the larger of input and cache-write rates. */
export function estimateCost(usage: Usage, rate: Rate): number {
  const input = usage.inputTokens ?? 0
  const cached = Math.min(usage.cachedTokens ?? 0, input)
  const uncachedRate = Math.max(rate.input, rate.cacheWrite ?? 0)
  return ((input - cached) * uncachedRate + cached * rate.cacheRead + (usage.outputTokens ?? 0) * rate.output) / 1e6
}

const rates = new Map<string, Rate>()
if (RATES_FILE) {
  for (const [model, rate] of Object.entries(JSON.parse(readFileSync(RATES_FILE, 'utf8')) as Record<string, Rate>)) {
    if (!rate || ![rate.input, rate.cacheRead, rate.output, rate.cacheWrite ?? 0].every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0))
      throw new Error(`Invalid rates for ${model}: prices must be finite, nonnegative numbers`)
    rates.set(bare(model), rate)
  }
}
if (BUDGET_USD !== null && (!Number.isFinite(BUDGET_USD) || BUDGET_USD < 0 || !rates.size)) {
  console.error('--budget-usd needs a nonnegative number and a --rates file to price responses against')
  process.exit(2)
}

/** Estimated spend so far across every proxy log in the spend directory. Re-read per request; the logs are small. */
function spentUsd(): number {
  let total = 0
  for (const file of readdirSync(SPEND_DIR).filter(f => f.endsWith('.jsonl'))) {
    const lines = readFileSync(join(SPEND_DIR, file), 'utf8').split('\n')
    for (const [index, line] of lines.entries()) {
      if (!line.includes('estCostUsd')) continue
      let entry: { estCostUsd?: unknown }
      try { entry = JSON.parse(line) } catch (error) {
        if (index === lines.length - 1) continue // Another proxy may be appending its last line.
        throw error
      }
      const cost = entry.estCostUsd
      if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0) throw new Error(`Invalid spending estimate in ${file}`)
      total += cost
    }
  }
  return total
}

let logUnavailable = false
function log(entry: Record<string, unknown>) {
  try { appendFileSync(LOG, `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`) }
  catch {
    if (!logUnavailable) console.error('Proxy accounting log cannot be written; budgeted requests are disabled until restart.')
    logUnavailable = true
    stats.errors++
  }
}

// Validate existing accounting before advertising a listening server.
const initialSpend = BUDGET_USD !== null ? spentUsd() : null
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
    let rewrote: string | null = null
    let effort: unknown = undefined

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const raw = await req.text()
      const restricted = Boolean(ONLY_MODEL || BUDGET_USD !== null || REJECT_HOSTED_TOOLS)
      if (restricted && !PINNABLE.test(url.pathname)) {
        return Response.json({ error: { code: 'endpoint_not_allowed', message: 'This evaluation proxy only supports the configured model inference endpoints' } }, { status: 403 })
      }
      if (restricted && !raw) return Response.json({ error: { code: 'invalid_request', message: 'Model requests must be JSON objects' } }, { status: 400 })
      if (PINNABLE.test(url.pathname) && raw) {
        let parsed: Record<string, unknown> | undefined
        try {
          const value: unknown = JSON.parse(raw)
          if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a JSON object')
          parsed = value as Record<string, unknown>
        } catch {
          if (restricted) return Response.json({ error: { code: 'invalid_request', message: 'Model requests must be JSON objects' } }, { status: 400 })
          body = raw
        }
        if (parsed) {
          model = parsed.model
          const requiredPin = typeof model === 'string' ? pins.get(bare(model)) ?? DEFAULT_VENDOR ?? null : null
          // An explicit vendor from the caller wins; this proxy sets a default,
          // it does not override a deliberate choice.
          if (parsed.vendor === undefined && typeof model === 'string') {
            pin = requiredPin
            if (pin) {
              parsed.vendor = pin
              stats.pinned++
            } else {
              stats.unpinned++
              unpinnedModels.add(model)
            }
          }
          if (ONLY_MODEL && (typeof model !== 'string' || bare(model) !== bare(ONLY_MODEL)
              || requiredPin === null || parsed.vendor !== requiredPin)) {
            log({ path: url.pathname, status: 403, ms: Date.now() - started, model, vendor: parsed.vendor ?? null, blocked: 'model' })
            return Response.json({ error: { type: 'permission_error', code: 'model_not_allowed',
              message: `Only ${ONLY_MODEL} via its configured vendor is available in this evaluation`, source: 'heval-vendor-proxy' } }, { status: 403 })
          }
          if (BUDGET_USD !== null) {
            try { appendFileSync(LOG, '') } catch { logUnavailable = true }
            if (logUnavailable) return Response.json({ error: { code: 'spend_unavailable', message: 'Cannot write spending records; the request was refused' } }, { status: 503 })
            if (typeof model !== 'string' || !rates.has(bare(model))) {
              return Response.json({ error: { code: 'rate_missing', message: 'A configured model price is required for budgeted requests' } }, { status: 400 })
            }
            let spent: number
            try { spent = spentUsd() } catch {
              log({ path: url.pathname, status: 503, model, blocked: 'spend_unavailable' })
              return Response.json({ error: { code: 'spend_unavailable', message: 'Cannot read the shared spending records; the request was refused' } }, { status: 503 })
            }
            if (spent >= BUDGET_USD) {
              log({ path: url.pathname, status: 402, ms: Date.now() - started, model, blocked: 'budget', spentUsd: spent })
              return Response.json({ error: { type: 'budget_exhausted', code: 'budget_exhausted',
                message: `Evaluation spend limit reached: $${spent.toFixed(2)} of $${BUDGET_USD}`, source: 'heval-vendor-proxy' } }, { status: 402 })
            }
          }
          const hosted = REJECT_HOSTED_TOOLS ? hostedTools(parsed) : []
          if (hosted.length) {
            log({ path: url.pathname, status: 400, ms: Date.now() - started, model, rejected: hosted })
            return Response.json({ error: { type: 'invalid_request_error', code: 'hosted_tool_rejected',
              message: `Hosted tools are disabled for this evaluation: ${hosted.join(', ')}`, source: 'heval-vendor-proxy' } }, { status: 400 })
          }
          // Logged so each harness's effort setting is verified from its requests, not assumed.
          effort = parsed.reasoning_effort ?? (parsed.reasoning as { effort?: unknown } | undefined)?.effort
            ?? (parsed.output_config as { effort?: unknown } | undefined)?.effort
            ?? (parsed.thinking as { type?: unknown } | undefined)?.type
          const thinking = parsed.thinking as { type?: unknown } | undefined
          if (THINKING_AS_EFFORT && thinking?.type === 'enabled' && typeof parsed.reasoning_effort === 'string') {
            delete parsed.thinking
            rewrote = 'thinking->reasoning_effort'
          }
          body = JSON.stringify(parsed)
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

      const entry = {
        path: url.pathname, status: res.status, ms: Date.now() - started,
        model, pinned: pin, served: servedVendor,
        ...(rewrote ? { rewrote } : {}),
        ...(effort !== undefined ? { effort } : {}),
        ...(mismatch ? { mismatch: true } : {}),
      }
      if (mismatch) console.warn(`  ! pinned ${pin} but gateway served ${servedVendor} (${String(model)})`)
      if (pin === null && typeof model === 'string') console.warn(`  ! no vendor pin for ${model}; the gateway chose the route`)

      // Returned as-is so SSE streams through unbuffered; both harnesses stream,
      // and buffering here would distort the very latency we are measuring. Model
      // calls are logged when their copy of the body ends, with the usage it held.
      if (!res.body || !PINNABLE.test(url.pathname)) {
        log(entry)
        return new Response(res.body, { status: res.status, headers: res.headers })
      }
      const rate = typeof model === 'string' ? rates.get(bare(model)) : undefined
      const client = withUsage(res.body, (usage, error) => log({
        ...entry,
        ...(usage ? { usage } : {}),
        ...(usage && rate ? { estCostUsd: estimateCost(usage, rate) } : {}),
        ...(error ? { usageError: error } : {}),
      }), res.headers.get('content-type') ?? '')
      return new Response(client, { status: res.status, headers: res.headers })
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
if (THINKING_AS_EFFORT) console.log('  rewrite     thinking -> reasoning_effort when both are sent')
if (REJECT_HOSTED_TOOLS) console.log('  reject      requests declaring provider-hosted tools')
if (ONLY_MODEL) console.log(`  only        ${ONLY_MODEL} via ${pins.get(bare(ONLY_MODEL)) ?? DEFAULT_VENDOR}; other models get 403`)
if (RATES_FILE) console.log(`  rates       ${rates.size} models from ${RATES_FILE}`)
if (BUDGET_USD !== null) console.log(`  budget      $${BUDGET_USD} across ${SPEND_DIR}/*.jsonl (spent so far $${initialSpend!.toFixed(2)})`)

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
// One failed stream must not take down every trial routed through this proxy.
for (const event of ['uncaughtException', 'unhandledRejection'] as const) {
  process.on(event, err => {
    stats.errors++
    const message = err instanceof Error ? err.message : String(err)
    console.error(`  ! ${event}: ${message}`)
    log({ error: message, event })
  })
}
