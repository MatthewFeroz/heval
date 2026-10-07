import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { countRequests, readProxyLog, readTurns } from './turns'

const roots: string[] = []
function trial(files: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), 'harbor-turns-'))
  roots.push(dir)
  mkdirSync(join(dir, 'agent'))
  for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, 'agent', name), body)
  return dir
}
const lines = (...events: object[]) => events.map(e => JSON.stringify(e)).join('\n')
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('turn accounting', () => {
  test('reports a Claude Code max-turns stop as a cap hit', () => {
    const dir = trial({ 'claude-code.txt': lines({ type: 'system' }, { type: 'result', subtype: 'error_max_turns', num_turns: 100 }) })
    expect(readTurns(dir, 'claude-code', { max_turns: 100 })).toEqual({ turns: 100, turnSource: 'claude-code num_turns', turnCap: 100, capHit: 1 })
  })
  test('counts Pi turns and leaves the hit rate empty without a cap', () => {
    const dir = trial({ 'pi.txt': lines({ type: 'turn_start' }, { type: 'turn_end' }, { type: 'turn_start' }) })
    expect(readTurns(dir, 'pi', {})).toEqual({ turns: 2, turnSource: 'pi turn_start events', turnCap: null, capHit: null })
  })
  test('counts ATIF agent steps and treats reaching the cap as a hit', () => {
    const steps = [{ source: 'user' }, ...Array.from({ length: 3 }, () => ({ source: 'agent' }))]
    const dir = trial({ 'trajectory.json': JSON.stringify({ steps }) })
    expect(readTurns(dir, 'codex', { max_turns: '3' })).toMatchObject({ turns: 3, turnSource: 'ATIF agent steps', capHit: 1 })
  })
  test('attributes model calls by agent window and refuses overlapping windows', () => {
    const dir = trial({})
    const log = join(dir, 'proxy.jsonl')
    writeFileSync(log, lines(
      { ts: '2026-09-24T10:00:01Z', path: '/v1/openai/responses', status: 200, pinned: 'particle', served: 'particle' },
      { ts: '2026-09-24T10:00:02Z', path: '/v1/openai/models', status: 200 },
      { ts: '2026-09-24T10:00:03Z', path: '/v1/anthropic/v1/messages', status: 502, pinned: 'particle', served: 'other' },
      { ts: '2026-09-24T10:05:00Z', path: '/v1/openai/chat/completions', status: 200 },
    ))
    const at = (s: string) => Date.parse(`2026-09-24T${s}Z`)
    const counts = countRequests([
      { trial: 'a', start: at('10:00:00'), end: at('10:01:00') },
      { trial: 'b', start: at('10:04:00'), end: at('10:06:00') },
      { trial: 'c', start: at('10:05:30'), end: at('10:07:00') },
    ], readProxyLog(log))
    expect(counts.get('a')).toMatchObject({ modelRequests: 2, modelRequestErrors: 1, vendorMismatches: 1, proxyCostUsd: null })
    expect(counts.get('b')?.modelRequests).toBeNull()
    expect(counts.get('c')?.modelRequests).toBeNull()
  })
  test('sums gateway usage per attempt and prices unbilled responses at the route rate', () => {
    const route = { vendor: 'particle', inputPerMillion: 0.1, outputPerMillion: 0.4, cacheReadPerMillion: 0.002 } as never
    const t = Date.parse('2026-09-24T10:00:00Z')
    const billed = { ts: '2026-09-24T10:00:01Z', status: 200, usage: { inputTokens: 100, cachedTokens: 0, outputTokens: 10, costUsd: 0.5 } }
    const unbilled = { ts: '2026-09-24T10:00:02Z', status: 200, usage: { inputTokens: 1_000_000, cachedTokens: 0, outputTokens: 0, costUsd: null } }
    const one = countRequests([{ trial: 'a', start: t, end: t + 60_000 }], [billed])
    expect(one.get('a')).toMatchObject({ proxyInputTokens: 100, proxyOutputTokens: 10, proxyCostUsd: 0.5, proxyCostSource: 'billed' })
    const both = countRequests([{ trial: 'a', start: t, end: t + 60_000 }], [billed, unbilled], route)
    expect(both.get('a')?.proxyCostUsd).toBeCloseTo(0.6)
    expect(both.get('a')?.proxyCostSource).toBe('billed+catalog')
    // Without a rate card an unbilled response makes the attempt's cost unknown, not understated.
    expect(countRequests([{ trial: 'a', start: t, end: t + 60_000 }], [billed, unbilled]).get('a')?.proxyCostUsd).toBeNull()
  })
})
