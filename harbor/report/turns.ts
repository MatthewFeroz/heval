/**
 * Per-attempt turn accounting: the harness's own turn count, whether its turn
 * cap stopped the attempt, and how many model requests the proxy saw.
 *
 * HarnessTax caps each attempt at 100 turns "following each harness's own
 * definition", so the native counts are not comparable across harnesses: a
 * Claude Code turn, a Pi loop iteration and a Codex ATIF agent step measure
 * different things. The proxy request count is the harness-neutral figure: one
 * row per model call, logged the same way whichever harness made it.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { priceTokens, type VendorRoute } from '../gateway/catalog'

type Json = Record<string, unknown>

export type Turns = {
  turns: number | null
  /** What `turns` counts, since it differs per harness. */
  turnSource: 'claude-code num_turns' | 'pi turn_start events' | 'ATIF agent steps' | null
  /** Configured cap, or null when the harness ran without one. */
  turnCap: number | null
  /** 1 when the cap stopped the attempt; null when no cap was configured. */
  capHit: 0 | 1 | null
}

const jsonLines = (path: string): Json[] =>
  readFileSync(path, 'utf8').split('\n').flatMap(line => {
    if (!line.startsWith('{')) return []
    try { return [JSON.parse(line) as Json] } catch { return [] }
  })

function nativeTurns(dir: string, agent: string): Pick<Turns, 'turns' | 'turnSource'> & { capSignal?: boolean } {
  const agentDir = join(dir, 'agent')
  const claude = join(agentDir, 'claude-code.txt')
  if (agent === 'claude-code' && existsSync(claude)) {
    const result = jsonLines(claude).findLast(e => e.type === 'result')
    if (result && typeof result.num_turns === 'number') {
      return { turns: result.num_turns, turnSource: 'claude-code num_turns', capSignal: result.subtype === 'error_max_turns' }
    }
  }
  const pi = join(agentDir, 'pi.txt')
  if (agent === 'pi' && existsSync(pi)) {
    return { turns: jsonLines(pi).filter(e => e.type === 'turn_start').length, turnSource: 'pi turn_start events' }
  }
  const trajectory = join(agentDir, 'trajectory.json')
  if (existsSync(trajectory)) {
    const steps = (JSON.parse(readFileSync(trajectory, 'utf8')) as Json).steps
    if (Array.isArray(steps)) {
      return { turns: steps.filter(s => (s as Json)?.source === 'agent').length, turnSource: 'ATIF agent steps' }
    }
  }
  return { turns: null, turnSource: null }
}

export function readTurns(dir: string, agent: string, kwargs: Json): Turns {
  const raw = kwargs.max_turns
  const cap = Number(raw)
  const turnCap = raw !== undefined && raw !== null && Number.isFinite(cap) && cap > 0 ? cap : null
  const { turns, turnSource, capSignal } = nativeTurns(dir, agent)
  // Claude Code reports the stop explicitly; otherwise reaching the cap is the signal.
  const capHit = turnCap === null ? null : capSignal || (turns !== null && turns >= turnCap) ? 1 : 0
  return { turns, turnSource, turnCap, capHit }
}

export type ProxyUsage = { inputTokens: number | null; outputTokens: number | null; cachedTokens: number | null; costUsd: number | null }
export type ProxyEntry = { ts: string; path?: string; status?: number; model?: string; pinned?: string | null; served?: string | null; usage?: ProxyUsage }

/** Model calls, matching the endpoints the proxy pins; catalog lookups are not requests. */
const MODEL_CALL = /\/(chat\/completions|completions|responses|messages)$/

export const readProxyLog = (path: string): ProxyEntry[] =>
  jsonLines(path).filter((e): e is ProxyEntry & Json => typeof e.ts === 'string' && MODEL_CALL.test(String(e.path ?? '')))

export type Window = { trial: string; start: number; end: number }

export type RequestCounts = {
  modelRequests: number | null
  modelRequestErrors: number | null
  vendorMismatches: number | null
  /** Summed from the usage the gateway returned on each response (see vendor-proxy.ts). */
  proxyInputTokens: number | null
  proxyCachedTokens: number | null
  proxyOutputTokens: number | null
  /**
   * Gateway-billed cost. A response that carried tokens but no cost (the
   * Anthropic endpoint) is priced at the route's catalog rate; `proxyCostSource`
   * says whether any request needed that.
   */
  proxyCostUsd: number | null
  proxyCostSource: 'billed' | 'billed+catalog' | null
}

const EMPTY: RequestCounts = {
  modelRequests: null, modelRequestErrors: null, vendorMismatches: null, proxyInputTokens: null,
  proxyCachedTokens: null, proxyOutputTokens: null, proxyCostUsd: null, proxyCostSource: null,
}

/**
 * Attributes proxy rows to attempts by each attempt's agent-execution window.
 * The proxy log has no attempt id, so this only holds when attempts ran one at
 * a time; attempts whose windows overlap get null rather than a guessed share.
 */
export function countRequests(windows: Window[], log: ProxyEntry[], route: VendorRoute | null = null): Map<string, RequestCounts> {
  const out = new Map<string, RequestCounts>()
  const times = log.map(e => Date.parse(e.ts))
  for (const w of windows) {
    const overlaps = windows.some(o => o !== w && o.start < w.end && w.start < o.end)
    if (overlaps) { out.set(w.trial, EMPTY); continue }
    const inside = log.filter((_, i) => times[i] >= w.start && times[i] <= w.end)
    const withUsage = inside.filter(e => e.usage)
    const sum = (k: keyof ProxyUsage) => (withUsage.length ? withUsage.reduce((a, e) => a + (e.usage![k] ?? 0), 0) : null)
    let cost: number | null = withUsage.length ? 0 : null, priced = false
    for (const e of withUsage) {
      const u = e.usage!
      if (u.costUsd !== null) { cost! += u.costUsd; continue }
      const fallback = route ? priceTokens({ inputTokens: u.inputTokens, cacheTokens: u.cachedTokens, outputTokens: u.outputTokens }, route) : null
      if (fallback === null) { cost = null; break }
      cost! += fallback
      priced = true
    }
    out.set(w.trial, {
      modelRequests: inside.length,
      modelRequestErrors: inside.filter(e => e.status !== 200).length,
      vendorMismatches: inside.filter(e => e.pinned && e.served && e.pinned !== e.served).length,
      proxyInputTokens: sum('inputTokens'),
      proxyCachedTokens: sum('cachedTokens'),
      proxyOutputTokens: sum('outputTokens'),
      proxyCostUsd: cost,
      proxyCostSource: cost === null ? null : priced ? 'billed+catalog' : 'billed',
    })
  }
  return out
}
