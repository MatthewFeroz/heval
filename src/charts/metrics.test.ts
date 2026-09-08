import { expect, test } from 'bun:test'
import { costPerSuccess } from './metrics'
import type { TrialRow } from './trial'
import { buildChart, controlsFor, DEFAULT_STATE } from './recipes'
import { compile } from 'vega-lite'
import { parse, View } from 'vega'

const trial = (passed: 0 | 1, costUsd: number | null) => ({ passed, costUsd }) as TrialRow

test('cost per success includes failed attempts but requires complete pricing', () => {
  expect(costPerSuccess([trial(1, 2), trial(0, 4)])).toBe(6)
  expect(costPerSuccess([trial(1, 2), trial(1, null)])).toBeNull()
  expect(costPerSuccess([trial(1, 2), trial(0, null)])).toBeNull()
  expect(costPerSuccess([trial(0, 2)])).toBeNull()
  expect(costPerSuccess([trial(1, 0)])).toBe(0)
  expect(costPerSuccess([])).toBeNull()
})

test('strip summary marks and table both sum the selected measure', async () => {
  const rows = [2, 4].map((costUsd, index) => ({
    ...trial(1, costUsd), agent: 'codex', task: 'cache', trial: String(index),
  }))
  const chart = buildChart(rows, { recipe: 'strip', x: 'agent', color: 'none', facet: 'none', measure: 'costUsd', aggregate: 'sum' })
  expect(chart.table[0].value).toBe(6)
  const view = new View(parse(compile(chart.spec).spec), { renderer: 'none' })
  try {
    await view.runAsync()
    const svg = await view.toSVG()
    expect(svg).toMatch(/aria-label="Cost \(USD\): \$6\.00; agent: codex"[^>]*aria-roledescription="tick"/)
  } finally { view.finalize() }
})

test('Wilson controls only appear for a mean pass rate', () => {
  expect(controlsFor(DEFAULT_STATE).has('intervals')).toBe(true)
  expect(controlsFor({ ...DEFAULT_STATE, measure: 'costUsd' }).has('intervals')).toBe(false)
  expect(controlsFor({ ...DEFAULT_STATE, aggregate: 'sum' }).has('intervals')).toBe(false)
})
