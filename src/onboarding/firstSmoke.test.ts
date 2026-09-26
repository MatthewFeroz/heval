import { describe, expect, test } from 'bun:test'
import type { RunnerProfile } from '../runners/protocol'
import { firstSmokeProgress } from './firstSmoke'

const now = 1_000_000
const profile = (agent: string, extra: Partial<RunnerProfile> = {}): RunnerProfile => ({ id: agent, digest: 'd', title: agent, benchmark: 'Setup task', agent, model: 'deepseek/v4-flash', tasks: 1, attempts: 1, timeoutSeconds: 600, setupCheck: false, taskSet: 't', vendor: 'particle', maxAttempts: 3, ...extra })
const oracle = profile('oracle', { id: 'check', setupCheck: true })
const machine = (profiles: RunnerProfile[], extra = {}) => ({ id: 'm1', name: 'My computer', revoked: false, lastSeen: now, ready: true, health: 'Ready', profiles, ...extra })
const run = (p: RunnerProfile, status: 'queued' | 'completed' | 'failed', experiment: string | null = null) => ({ id: `${p.id}-${status}`, runner: 'm1', profile: p, experiment, status, phase: status, message: null, report: status === 'completed' ? 'r1' : null })

describe('first smoke test progress', () => {
  test('a new account starts by installing a worker', () => {
    const progress = firstSmokeProgress({ machines: [], runs: [], now })
    expect(progress.current).toBe('install')
    expect(progress.harness).toBe('codex')
  })

  test('a paired worker without a model profile asks for the provider', () => {
    const progress = firstSmokeProgress({ machines: [machine([oracle])], runs: [], now })
    expect(progress).toMatchObject({ current: 'provider', online: true, checkProfile: oracle })
  })

  test('the free check is part of the first evaluation, not a separate user step', () => {
    const machines = [machine([oracle, profile('codex')])]
    expect(firstSmokeProgress({ machines, runs: [], now }).current).toBe('run')
    expect(firstSmokeProgress({ machines, runs: [run(oracle, 'failed')], now }).current).toBe('run')
    expect(firstSmokeProgress({ machines, runs: [run(oracle, 'completed')], now }).current).toBe('run')
  })

  test('only a completed experiment run with the harness finishes the guide', () => {
    const codex = profile('codex')
    const machines = [machine([oracle, codex])]
    const checked = run(oracle, 'completed')
    expect(firstSmokeProgress({ machines, runs: [run(codex, 'queued', 'e1'), checked], now }).current).toBe('run')
    const passed = firstSmokeProgress({ machines, runs: [run(codex, 'completed', 'e1'), checked], now })
    expect(passed.current).toBeNull()
    expect(passed.smokeRun?.report).toBe('r1')
  })

  test('prefers Codex and its smallest task set, falling back to another configured harness', () => {
    const large = profile('codex', { id: 'codex-100', tasks: 100 })
    expect(firstSmokeProgress({ machines: [machine([large, profile('codex'), profile('pi')])], runs: [], now }).profile?.id).toBe('codex')
    expect(firstSmokeProgress({ machines: [machine([profile('pi')])], runs: [], now }).harness).toBe('pi')
  })

  test('a switched-off worker is reported separately from offline', () => {
    expect(firstSmokeProgress({ machines: [machine([oracle], { enabled: false })], runs: [], now })).toMatchObject({ online: true, switchedOff: true })
  })

  test('profiles missing launch settings do not count, and offline or revoked workers are reported', () => {
    expect(firstSmokeProgress({ machines: [machine([profile('codex', { taskSet: undefined })])], runs: [], now }).current).toBe('provider')
    expect(firstSmokeProgress({ machines: [machine([oracle], { lastSeen: 0 })], runs: [], now }).online).toBe(false)
    expect(firstSmokeProgress({ machines: [machine([oracle], { revoked: true })], runs: [], now }).current).toBe('install')
  })
})
