import { expect, test } from 'bun:test'
import fixture from '../../results/harbor/demo-evaluation.json'
import type { TrialRow } from '../charts/trial'
import { comparability, groupTasks, outcome } from './taskComparison'
import { lifecycleTimeline, parseTimeline, validateEvidence } from './runArtifacts'
const row = fixture.rows[0] as TrialRow
test('task groups retain repeated attempts, prioritize disagreement and distinguish dataset identity', () => {
  const rows = [row, { ...row, trial: 'failed', passed: 0 as const }, { ...row, trial: 'repeat' }, { ...row, trial: 'other-dataset', dataset: 'other' }]
  const groups = groupTasks(rows)
  expect(groups).toHaveLength(2)
  expect(groups[0]).toMatchObject({ disagreement: true })
  expect(groups[0].rows).toHaveLength(3)
  expect(outcome({ ...row, error: 'Execution failed', passed: 1 })).toBe('Execution error')
  expect(outcome({ ...row, passed: 0, timedOut: 1 })).toBe('Timed out')
})
test('comparison requires pinned matching task content and versions', () => {
  const second = { ...row, trial: 'second' }
  expect(comparability(row, second)).toBeNull()
  expect(comparability(row, row)).toContain('different attempts')
  expect(comparability(row, { ...second, taskChecksum: null })).toContain('cannot be verified')
  expect(comparability(row, { ...second, taskChecksum: 'changed' })).toContain('content differs')
  expect(comparability(row, { ...second, datasetVersion: 'changed' })).toContain('versions differ')
})
test('recorded lifecycle uses actual monitoring, even when earlier events have rolled off', () => {
  const value = lifecycleTimeline('one', { sequence: 4, sampledAt: 1000, trials: [{ id: 'one', state: 'passed', startedAt: 100, updatedAt: 900, finishedAt: 900 }], events: [] })!
  expect(parseTimeline(JSON.stringify(value)).events.map(event => event.kind)).toEqual(['started', 'passed'])
  expect(value.events.map(event => event.at)).toEqual([100, 900])
  expect(lifecycleTimeline('missing', { sequence: 1, sampledAt: 1000, trials: [], events: [] })).toBeNull()
})
test('evidence rejects unsupported formats, oversized text and invalid event sequences', () => {
  expect(() => validateEvidence('verifier', 'x'.repeat(16_001))).toThrow('16 KB')
  expect(() => validateEvidence('html', '<h1>Recorded output</h1>')).not.toThrow()
  expect(() => validateEvidence('image', 'https://example.invalid/tracking.png')).toThrow('embedded PNG')
  expect(() => parseTimeline(JSON.stringify({ schemaVersion: 1, events: [{ at: 20, kind: 'command', title: 'One' }, { at: 10, kind: 'message', title: 'Two' }] }))).toThrow('ordered')
})
