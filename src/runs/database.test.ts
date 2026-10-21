import { describe, expect, test } from 'bun:test'
import { describeTask } from './build'
import {
  compareSetup, defaultPair, formatDuration, orderedStacks, passCount, readSelection, selectionSearch,
  type RunDatabase,
} from './database'
import committed from './run-database.json'
import { scatterAxis, scatterMedian, scatterTrials } from './scatter'

const database = committed as RunDatabase
const study = (id: string) => database.studies.find(item => item.id === id)!

describe('run database', () => {
  test('plots genuine zero measurements on linear axes without inventing missing values', () => {
    const base = database.studies[0].trials[0]
    const trials = [
      { ...base, id: 'zero', costUsd: 0, agentSeconds: 0 },
      { ...base, id: 'missing-cost', costUsd: null },
      { ...base, id: 'missing-time', agentSeconds: null },
      { ...base, id: 'invalid', costUsd: -1 },
      { ...base, id: 'infinite', costUsd: Infinity },
      { ...base, id: 'measured', costUsd: .001, agentSeconds: 30 },
    ]
    expect(scatterTrials(trials, 'linear').map(trial => trial.id)).toEqual(['zero', 'measured'])
    expect(scatterTrials(trials, 'log').map(trial => trial.id)).toEqual(['measured'])
    expect(scatterAxis([0], 'linear').position(0)).toBe(0)
    expect(Number.isFinite(scatterAxis([], 'log').position(1))).toBe(true)
  })

  test('keeps outliers on the chart and shows ratios on log axes', () => {
    const axis = scatterAxis([.001, .01, .1, 28.36], 'log')
    expect(axis.position(.001)).toBeGreaterThan(0)
    expect(axis.position(28.36)).toBeLessThan(1)
    expect(axis.position(.01) - axis.position(.001)).toBeCloseTo(axis.position(.1) - axis.position(.01))
    expect(scatterAxis([0, 30], 'linear').position(0)).toBe(0)
  })

  test('computes coordinate medians across passes and failures', () => {
    const base = database.studies[0].trials[0]
    const trials = scatterTrials([
      { ...base, passed: true, costUsd: 1, agentSeconds: 200 },
      { ...base, passed: false, costUsd: 9, agentSeconds: 100 },
    ], 'log')
    expect(scatterMedian(trials)).toEqual({ cost: 5, seconds: 150 })
    expect(scatterMedian([])).toBeNull()
  })

  test('reproduces the published headline numbers', () => {
    const swe = study('swe-bench-lite')
    const rate = (stack: string) => passCount(swe, trial => trial.stack === stack) / swe.tasks.length
    expect(Math.round(rate('deepseek-harness / deepseek-v4.1-flash') * 100)).toBe(75)
    expect(Math.round(rate('pi / deepseek-v4.1-flash') * 100)).toBe(61)
    const tb = study('terminal-bench')
    expect(tb.trials).toHaveLength(tb.tasks.length * tb.stacks.length)
    expect(orderedStacks(tb)[0].modelName).toBe('GLM 5.3')
  })

  test('names SWE-bench tasks after their upstream pull request', () => {
    expect(describeTask('swebench-verified__astropy__astropy-7746')).toEqual({
      id: 'swebench-verified__astropy__astropy-7746', name: 'astropy-7746', repository: 'astropy/astropy', url: 'https://github.com/astropy/astropy/pull/7746',
    })
    expect(describeTask('swebench-verified__scikit-learn__scikit-learn-13241').repository).toBe('scikit-learn/scikit-learn')
    expect(describeTask('fix-git')).toEqual({ id: 'fix-git', name: 'fix-git', repository: null, url: null })
  })

  test('opens on the study headline: same task, featured stack passed, the other did not', () => {
    for (const item of database.studies) {
      const [a, b] = defaultPair(item)
      expect([a.stack, b?.stack]).toEqual(item.featured)
      expect(a.task).toBe(b!.task)
      expect([a.passed, b!.passed]).toEqual([true, false])
    }
  })

  test('reports what a comparison held constant and what it changed', () => {
    const tb = study('terminal-bench')
    const [a, b] = defaultPair(tb)
    const setup = compareSetup(tb, a, b!)
    expect(setup.constant.map(field => field.label)).toEqual(['Task', 'Harness'])
    expect(setup.changed.map(field => field.label)).toEqual(['Model'])
    const otherTask = tb.trials.find(trial => trial.stack === a.stack && trial.task !== a.task)!
    expect(compareSetup(tb, a, otherTask).changed.map(field => field.label)).toEqual(['Task'])
  })

  test('restores a shared selection and ignores ids it does not know', () => {
    const swe = study('swe-bench-lite')
    const [a, b] = [swe.trials[3], swe.trials[40]]
    const search = selectionSearch(swe, [a, b])
    expect(readSelection(database, search).pair.map(trial => trial?.id)).toEqual([a.id, b.id])
    expect(readSelection(database, '?study=swe-bench-lite&a=missing').pair).toEqual(defaultPair(swe))
    expect(readSelection(database, `?study=swe-bench-lite&a=${a.id}&b=${a.id}`).pair).toEqual([a, null])
    expect(readSelection(database, '?study=unknown').study.id).toBe(database.studies[0].id)
  })

  test('preserves recorded gateway usage and native turn definitions', () => {
    const swe = study('swe-bench-lite')
    const deepseek = swe.trials.find(trial => trial.id === 'django__django-12308__7fWj2JG')!
    expect([deepseek.inputTokens, deepseek.cacheTokens, deepseek.outputTokens, deepseek.tokenSource]).toEqual([820297, 750336, 59297, 'gateway'])
    const claude = swe.trials.find(trial => trial.id === 'django__django-11815__mtnQLyQ')!
    expect(claude.turnSource).toBe('claude-code num_turns')
    expect(claude.turnCap).toBe(100)
    expect(claude.costSource).toBe('gateway billed+catalog')
    const pi = swe.trials.find(trial => trial.task === claude.task && trial.stack.startsWith('pi /'))!
    const setup = compareSetup(swe, claude, pi)
    expect(setup.changed.map(field => field.label)).toEqual(['Harness'])
    expect(setup.unknown.map(field => field.label)).toEqual(['Reasoning effort', 'Thinking setting'])
    expect(setup.unknown.find(field => field.label === 'Thinking setting')?.b).toBe('high')
  })

  test('formats durations for the grid', () => {
    expect(formatDuration(44.2)).toBe('44s')
    expect(formatDuration(121)).toBe('2m 01s')
    expect(formatDuration(3725)).toBe('1h 02m')
    expect(formatDuration(null)).toBe('not recorded')
  })
})
