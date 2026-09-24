import { expect, test } from 'bun:test'
import { resolveSocial, socialSettings, SOCIAL_DEFAULTS } from './social-presets'
import { socialSvg } from './social-render'
import type { TrialRow } from './trial'
import { readFileSync } from 'node:fs'
const real = JSON.parse(readFileSync('results/harbor/demo-evaluation.json', 'utf8'))
  .rows as TrialRow[]
const models = ['model-a', 'model-b', 'model-c', 'model-d', 'model-e']
const options = { ...SOCIAL_DEFAULTS, models }
test('thread presets compute known synthetic outcomes across 20 tasks', () => {
  const completed = resolveSocial(real, options)
  expect(completed.bars.map((b) => b.value)).toEqual([16, 14, 12, 10, 8])
  const cost = resolveSocial(real, { ...options, preset: 'total-cost' })
  expect(cost.title).toBe('Total cost across 20 tasks')
  expect(cost.bars.find((b) => b.key === 'model-a')!.value).toBeCloseTo(0.2)
  expect(cost.bars.find((b) => b.key === 'model-b')!.value).toBeCloseTo(0.4)
  const perSuccess = resolveSocial(real, { ...options, preset: 'cost-per-success' })
  expect(perSuccess.bars.slice(-2).map((b) => b.key)).toEqual([
    'model-b',
    'model-a',
  ])
  expect(perSuccess.bars.at(-1)!.value).toBeCloseTo(0.025)
  const slow = resolveSocial(real, { ...options, preset: 'slow-timeouts' })
  expect(slow.bars.find((b) => b.key === 'model-d')).toMatchObject({ value: 2, timeout: 2 })
  const matrix = resolveSocial(real, { ...options, preset: 'disagreement' })
  expect([matrix.matrix.length, matrix.allPassed, matrix.allFailed]).toEqual([8, 8, 4])
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
  const missing = real.map((r) => (r.modelShort === 'model-a' ? { ...r, costUsd: null } : r))
  expect(
    resolveSocial(missing, { ...options, preset: 'total-cost' }).bars.find((b) => b.key === 'model-a')!.value,
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
  const rows = real.map((r) => (r.modelShort === 'model-a' && r.passed ? { ...r, agentSeconds: null } : r))
  expect(
    resolveSocial(rows, { ...options, preset: 'median-time' }).bars.find((b) => b.key === 'model-a')!.value,
  ).toBeNull()
})
test('settings reject unknown presets and preserve deliberately hidden text', () => {
  expect(() => socialSettings({ ...options, preset: 'made-up' })).toThrow()
  expect(() => socialSettings({ ...options, collection: [] })).toThrow()
  expect(socialSettings(JSON.parse(JSON.stringify(options))).showSubtitle).toBe(false)
  const chart = resolveSocial(real, options),
    svg = socialSvg(chart, options, '')
  expect(svg).not.toContain('tasks per model')
  expect(svg).toContain('Source: Evaluation results')
  expect(svg).not.toContain('Gateway')
  expect(svg).toContain('#FFFFFF')
})

test('publishing themes round trip and reject unregistered themes', () => {
  expect(socialSettings({...options,theme:'plain-light'}).theme).toBe('plain-light')
  expect(socialSettings({...options,theme:undefined}).theme).toBe('plain-light')
  expect(()=>socialSettings({...options,theme:'unknown'})).toThrow('theme')
})

test('public publishing themes never render corporate branding', () => {
  for (const theme of ['plain-light', 'plain-dark'] as const) {
    const settings = socialSettings({ ...options, theme })
    const svg = socialSvg(resolveSocial(real, settings), settings, '<svg><path id="unwanted-brand"/></svg>')
    expect(svg).not.toContain('unwanted-brand')
    expect(svg).not.toContain('Gateway')
    expect(svg).not.toContain('data-model-mark')
  }
  expect(socialSettings(undefined).theme).toBe('plain-light')
  expect(socialSettings(undefined).source).toBe('Evaluation results')
})
