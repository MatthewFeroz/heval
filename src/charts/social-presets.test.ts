import { expect, test } from 'bun:test'
import { resolveSocial, socialSettings, SOCIAL_DEFAULTS } from './social-presets'
import { socialSvg } from './social-render'
import type { TrialRow } from './trial'
import { readFileSync } from 'node:fs'
const real = JSON.parse(readFileSync('results/harbor/terminal-bench-comparison.json', 'utf8'))
  .rows as TrialRow[]
const models = ['glm-5.3', 'glm-5.3-flash', 'kimi-k3', 'deepseek-v4-flash', 'deepseek-v4-pro-0813']
const options = { ...SOCIAL_DEFAULTS, models }
test('thread presets reproduce the audited cohort and use 20 actual tasks', () => {
  const completed = resolveSocial(real, options)
  expect(completed.bars.map((b) => b.value)).toEqual([14, 12, 11, 10, 9])
  const cost = resolveSocial(real, { ...options, preset: 'total-cost' })
  expect(cost.title).toBe('Total cost across 20 tasks')
  expect(cost.bars.find((b) => b.key === 'glm-5.3')!.value).toBeCloseTo(4.43102134)
  expect(cost.bars.find((b) => b.key === 'glm-5.3-flash')!.value).toBeCloseTo(0.78682721)
  const perSuccess = resolveSocial(real, { ...options, preset: 'cost-per-success' })
  expect(perSuccess.bars.slice(-2).map((b) => b.key)).toEqual([
    'glm-5.3-flash',
    'deepseek-v4-flash',
  ])
  expect(perSuccess.bars.at(-1)!.value).toBeCloseTo(0.03222819)
  const slow = resolveSocial(real, { ...options, preset: 'slow-timeouts' })
  expect(slow.bars.find((b) => b.key === 'deepseek-v4-flash')).toMatchObject({ value: 10, timeout: 4 })
  const matrix = resolveSocial(real, { ...options, preset: 'disagreement' })
  expect([matrix.matrix.length, matrix.allPassed, matrix.allFailed]).toEqual([15, 3, 2])
})
test('single-attempt cohort rejects missing tasks, duplicates and incompatible versions', () => {
  expect(() => resolveSocial(real.slice(1), options)).toThrow('one attempt')
  expect(() => resolveSocial([...real, real[0]], options)).toThrow('one attempt')
  expect(() =>
    resolveSocial(
      real.map((r, i) => (i === 0 ? { ...r, taskChecksum: 'wrong' } : r)),
      options,
    ),
  ).toThrow('version mismatch')
  expect(() =>
    resolveSocial(
      real.map((r, i) => (i === 0 ? { ...r, agent: 'different' } : r)),
      options,
    ),
  ).toThrow('mixed agent')
})
test('missing price is unavailable rather than zero and no passes is not free', () => {
  const missing = real.map((r) => (r.modelShort === 'glm-5.3' ? { ...r, costUsd: null } : r))
  expect(
    resolveSocial(missing, { ...options, preset: 'total-cost' }).bars.find((b) => b.key === 'glm-5.3')!.value,
  ).toBeNull()
  const none = real.map((r) => ({ ...r, passed: 0 as const }))
  expect(
    resolveSocial(none, { ...options, preset: 'cost-per-success' }).bars.every((b) => b.value === null),
  ).toBe(true)
})
test('slow threshold is strict and timeouts count once', () => {
  const rows = [
    { ...real[0], agentSeconds: 300, timedOut: 0, error: null },
    { ...real[0], task: 'second', agentSeconds: 20, timedOut: 1, error: 'AgentTimeoutError' },
  ] as TrialRow[]
  const settings = { ...options, models: [real[0].modelShort], preset: 'slow-timeouts' as const }
  expect(resolveSocial(rows, settings).bars[0]).toMatchObject({ value: 1, timeout: 1 })
  expect(() => resolveSocial([{ ...rows[0], agentSeconds: null }], settings)).toThrow('missing')
  expect(() => resolveSocial([{ ...rows[0], error: 'VerifierTimeoutError' }], settings)).toThrow('phase')
})
test('missing successful timing does not silently change median population', () => {
  const rows = real.map((r) => (r.modelShort === 'glm-5.3' && r.passed ? { ...r, agentSeconds: null } : r))
  expect(
    resolveSocial(rows, { ...options, preset: 'median-time' }).bars.find((b) => b.key === 'glm-5.3')!.value,
  ).toBeNull()
})
test('settings reject unknown presets and preserve deliberately hidden text', () => {
  expect(() => socialSettings({ ...options, preset: 'made-up' })).toThrow()
  expect(() => socialSettings({ ...options, collection: [] })).toThrow()
  expect(socialSettings(JSON.parse(JSON.stringify(options))).showSubtitle).toBe(false)
  const chart = resolveSocial(real, options),
    svg = socialSvg(chart, options, '')
  expect(svg).not.toContain('tasks per model')
  expect(svg).toContain('Source: Merge Evaluations')
  expect(svg).toContain('#C6ADCA')
})

test('publishing themes round trip and reject unregistered themes', () => {
  expect(socialSettings({...options,theme:'merge-light'}).theme).toBe('merge-light')
  expect(socialSettings({...options,theme:undefined}).theme ?? 'merge-dark').toBe('merge-dark')
  expect(()=>socialSettings({...options,theme:'unknown'})).toThrow('theme')
})
