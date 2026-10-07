import { expect, test } from 'vitest'
import { summarizeRun } from './runResults'
import { parseReport } from '../src/reports/format'
import fixture from '../tests/fixtures/report-sharing.json'

test('run summaries keep successful medians, complete totals and observed harness versions', () => {
  const rows = parseReport(JSON.stringify({ ...fixture, rows: [
    { ...fixture.rows[0], trial: 'one', passed: 1, reward: 1, agentSeconds: 10, inputTokens: 100, outputTokens: 20, costUsd: 1, agentVersion: 'v1' },
    { ...fixture.rows[0], trial: 'two', passed: 1, reward: 1, agentSeconds: 30, inputTokens: 200, outputTokens: 40, costUsd: 2, agentVersion: 'v2' },
    { ...fixture.rows[0], trial: 'three', passed: 1, reward: 1, agentSeconds: 20, inputTokens: 0, outputTokens: 0, costUsd: 0, agentVersion: 'v1' },
    { ...fixture.rows[0], trial: 'four', passed: 0, reward: 0, agentSeconds: 999, inputTokens: 50, outputTokens: 10, costUsd: 0.5, agentVersion: null },
  ] })).rows
  expect(summarizeRun(rows)).toEqual({ trials: 4, passed: 3, medianSeconds: 20, inputTokens: 350, outputTokens: 70, reportedCost: 3.5, versions: ['v1', 'v2'], additionalVersions: 0 })
  expect(summarizeRun(rows.slice(0, 2)).medianSeconds).toBe(20)
})

test('missing measurements stay unknown while recorded zero remains zero', () => {
  const row = parseReport(JSON.stringify({ ...fixture, rows: [{ ...fixture.rows[0], passed: 0, reward: 0, agentSeconds: null, inputTokens: 0, outputTokens: 0, costUsd: 0, agentVersion: null }] })).rows[0]
  expect(summarizeRun([row])).toEqual({ trials: 1, passed: 0, medianSeconds: null, inputTokens: 0, outputTokens: 0, reportedCost: 0, versions: [], additionalVersions: 0 })
  expect(summarizeRun([row, { ...row, trial: 'unknown', inputTokens: null, outputTokens: null, costUsd: null }])).toEqual({ trials: 2, passed: 0, medianSeconds: null, inputTokens: null, outputTokens: null, reportedCost: null, versions: [], additionalVersions: 0 })
  expect(summarizeRun([])).toEqual({ trials: 0, passed: 0, medianSeconds: null, inputTokens: null, outputTokens: null, reportedCost: null, versions: [], additionalVersions: 0 })
})

test('version previews keep encounter order and count omitted distinct versions without changing metrics', () => {
  const versions = Array.from({ length: 19 }, (_, i) => `v-${19 - i}`)
  const rows = parseReport(JSON.stringify({ ...fixture, rows: versions.map((agentVersion, i) => ({ ...fixture.rows[0], trial: `trial-${i}`, agentVersion, passed: 1, reward: 1, agentSeconds: 10, inputTokens: 1, outputTokens: 2, costUsd: 1 })) })).rows
  rows.push({ ...rows[0], trial: 'repeat-shown' }, { ...rows[18], trial: 'repeat-omitted' }, { ...rows[0], trial: 'unknown-version', agentVersion: null })
  expect(summarizeRun(rows)).toEqual({ trials: 22, passed: 22, medianSeconds: 10, inputTokens: 22, outputTokens: 44, reportedCost: 22, versions: versions.slice(0, 16), additionalVersions: 3 })
  expect(new Set(rows.flatMap(row => row.agentVersion ? [row.agentVersion] : [])).size).toBe(19)
})
