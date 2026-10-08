import { describe, expect, test } from 'bun:test'
import type { TrialRow } from '../../src/charts/trial'
import { bootstrapMean, studyStats, taskMeans, toCsv } from './study-stats'

const row = (agent: string, task: string, passed: 0 | 1, costUsd: number | null = 0.1, extra: Partial<TrialRow> = {}) =>
  ({ agent, task, passed, reward: passed, costUsd, agentVersion: '1.0', error: null, ...extra }) as TrialRow

describe('study statistics', () => {
  test('averages attempts within a task before averaging tasks', () => {
    // Task a: 3/3 passed, task b: 0/1. Attempt-level mean would be 0.75; task-level is 0.5.
    const rows = [row('pi', 'a', 1), row('pi', 'a', 1), row('pi', 'a', 1), row('pi', 'b', 0)]
    expect(taskMeans(rows, 'passed')).toEqual(new Map([['a', 1], ['b', 0]]))
    expect(studyStats(rows, 'pi')[0].success?.value).toBe(0.5)
  })
  test('bootstrap is reproducible and brackets the mean', () => {
    const values = [0, 1, 1, 0.5, 1, 0, 0.66, 1]
    const a = bootstrapMean(values)!, b = bootstrapMean(values)!
    expect(a).toEqual(b)
    expect(a.low).toBeLessThanOrEqual(a.value)
    expect(a.high).toBeGreaterThanOrEqual(a.value)
    const constant = bootstrapMean([0.4, 0.4, 0.4])!
    for (const v of [constant.value, constant.low, constant.high]) expect(v).toBeCloseTo(0.4, 12)
  })
  test('pairs differences by task and reports cost ratios against the baseline', () => {
    const rows = [
      row('pi', 'a', 1, 0.1), row('pi', 'b', 0, 0.1),
      row('claude-code', 'a', 1, 0.2), row('claude-code', 'b', 1, 0.2), row('claude-code', 'c', 1, 0.2),
    ]
    const cc = studyStats(rows, 'pi').find(s => s.harness === 'claude-code')!
    // Only tasks a and b are shared: deltas 0 and +1.
    expect(cc.successDelta?.value).toBe(0.5)
    expect(cc.costRatio).toBeCloseTo(2)
    expect(cc.success?.value).toBe(1)
  })
  test('keeps missing cost and uncapped harnesses explicit', () => {
    const rows = [row('pi', 'a', 1), row('deep-agents', 'a', 1, null), row('claude-code', 'a', 0, 0.1, { capHit: 1 })]
    const stats = studyStats(rows, 'pi')
    const da = stats.find(s => s.harness === 'deep-agents')!
    expect(da.cost).toBeNull()
    expect(da.costRatio).toBeNull()
    expect(da.capHits).toBe('uncapped')
    expect(stats.find(s => s.harness === 'claude-code')!.capHits).toBe('1/1')
    expect(toCsv(stats).split('\n')[0]).toContain('success_delta_low')
    expect(() => studyStats(rows, 'codex')).toThrow('Baseline codex')
  })
})
