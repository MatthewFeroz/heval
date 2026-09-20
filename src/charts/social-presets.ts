import { PRESENTATION_DEFAULT_THEME, PRESENTATION_DEFAULT_SOURCE } from './presentation-defaults'
import { SOCIAL_THEMES, type SocialTheme } from './social-themes'
import type { TrialRow } from './trial'
import { costPerSuccess, medianTimePassed, completionRate } from './metrics'

export const SOCIAL_PRESETS = {
  completed: { label: 'Tasks completed', layout: 'vertical', direction: 'higher', unit: 'count' },
  'cost-per-success': {
    label: 'Cost per successful task',
    layout: 'horizontal',
    direction: 'lower',
    unit: 'usd',
  },
  'total-cost': { label: 'Total task cost', layout: 'horizontal', direction: 'lower', unit: 'usd' },
  'median-time': {
    label: 'Median time per completed task',
    layout: 'horizontal',
    direction: 'lower',
    unit: 'seconds',
  },
  'slow-timeouts': {
    label: 'Tasks over 5 min / timeouts',
    layout: 'paired',
    direction: 'lower',
    unit: 'count',
  },
  disagreement: {
    label: 'Tasks where models differed',
    layout: 'matrix',
    direction: 'neutral',
    unit: 'count',
  },
  completion: { label: 'Completion rate', layout: 'vertical', direction: 'higher', unit: 'ratio' },
} as const
export const SOCIAL_QUESTIONS = {
  completed: 'Which model completes the most tasks?',
  'cost-per-success': 'What does a successful task cost?',
  'total-cost': 'How much did the evaluation cost?',
  'median-time': 'Which model finishes successful tasks fastest?',
  'slow-timeouts': 'Which models run slowly or time out?',
  disagreement: 'Where do the models disagree?',
  completion: 'What share of tasks does each model complete?',
} as const
export type SocialPreset = keyof typeof SOCIAL_PRESETS
export const THREAD_PRESETS: SocialPreset[] = [
  'completed',
  'total-cost',
  'median-time',
  'slow-timeouts',
]
export type SocialSettings = {
  version: 1
  preset: SocialPreset
  theme?: SocialTheme
  models: string[]
  collection: SocialPreset[]
  showSubtitle: boolean
  showDirection: boolean
  showSource: boolean
  source: string
}
export const SOCIAL_DEFAULTS: SocialSettings = {
  version: 1,
  preset: 'completed',
  theme: PRESENTATION_DEFAULT_THEME,
  models: [],
  collection: THREAD_PRESETS,
  showSubtitle: false,
  showDirection: false,
  showSource: true,
  source: PRESENTATION_DEFAULT_SOURCE,
}
export function socialSettings(value: unknown): SocialSettings {
  if (value === undefined)
    return { ...SOCIAL_DEFAULTS, models: [], collection: [...THREAD_PRESETS] }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid social settings')
  const v = { ...SOCIAL_DEFAULTS, ...value } as SocialSettings
  v.theme ??= PRESENTATION_DEFAULT_THEME
  if (!Object.hasOwn(SOCIAL_THEMES, v.theme))
    throw new Error('Unknown publishing theme')
  if (v.version !== 1 || !Object.hasOwn(SOCIAL_PRESETS, v.preset))
    throw new Error('Unknown social preset or settings version')
  for (const key of ['showSubtitle', 'showDirection', 'showSource'] as const)
    if (typeof v[key] !== 'boolean') throw new Error('Invalid visibility setting')
  if (typeof v.source !== 'string' || v.source.length > 150)
    throw new Error('Source must be at most 150 characters')
  if (
    !Array.isArray(v.models) ||
    v.models.length > 6 ||
    v.models.some((m) => typeof m !== 'string' || m.length > 250) ||
    new Set(v.models).size !== v.models.length
  )
    throw new Error('Select up to six distinct models')
  if (
    !Array.isArray(v.collection) ||
    !v.collection.length ||
    v.collection.length > 7 ||
    v.collection.some((p) => !Object.hasOwn(SOCIAL_PRESETS, p)) ||
    new Set(v.collection).size !== v.collection.length
  )
    throw new Error('Select distinct thread presets')
  return v
}
export type SocialBar = { key: string; value: number | null; timeout: number; n: number }
export type SocialChart = {
  preset: SocialPreset
  title: string
  tasks: number
  bars: SocialBar[]
  warnings: string[]
  matrix: { task: string; values: number[] }[]
  allPassed: number
  allFailed: number
}
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0

/** Single-attempt comparable cohort. Unknowns never become free, fast, or failed. */
export function resolveSocial(rows: readonly TrialRow[], settings: SocialSettings): SocialChart {
  const models = settings.models.length
    ? settings.models
    : [...new Set(rows.map((r) => r.modelShort))].sort()
  if (!models.length || models.length > 6) throw new Error('Select one to six models')
  if (rows.length > 3000) throw new Error('Select at most 3000 trials for social export')
  const selected = rows.filter((r) => models.includes(r.modelShort))
  if (models.some((m) => !selected.some((r) => r.modelShort === m)))
    throw new Error('A selected model has no trials')
  const cohortFields = [
    'agent',
    'agentVersion',
    'benchmark',
    'benchmarkVersion',
    'dataset',
    'datasetVersion',
  ] as const
  for (const field of cohortFields)
    if (new Set(selected.map((r) => r[field] ?? '')).size > 1)
      throw new Error('Select one compatible cohort: mixed ' + field)
  if (
    selected.some(
      (r) => !r.task || r.task === 'unknown' || !r.modelShort || r.modelShort === 'unknown',
    )
  )
    throw new Error('Task and model identities are required')
  const tasks = [...new Set(selected.map((r) => r.task))].sort()
  const warnings: string[] = []
  for (const task of tasks) {
    const rs = selected.filter((r) => r.task === task)
    if (new Set(rs.map((r) => r.taskChecksum).filter(Boolean)).size > 1)
      throw new Error('Task version mismatch: ' + task)
    for (const m of models)
      if (rs.filter((r) => r.modelShort === m).length !== 1)
        throw new Error(
          'Each model must have one attempt on each selected task. Missing or repeated task: ' +
            task,
        )
  }
  if (selected.some((r) => !r.taskChecksum))
    warnings.push('Task checksums unavailable for some trials; verify dataset identity.')
  if (new Set(selected.map((r) => r.vendor)).size > 1)
    warnings.push('Serving vendors differ across models.')
  if (selected.some((r) => r.costSource === 'derived'))
    warnings.push('Costs include token-derived estimates.')
  const needsPass = [
    'completed',
    'completion',
    'cost-per-success',
    'median-time',
    'disagreement',
  ].includes(settings.preset)
  if (needsPass && selected.some((r) => r.passed !== 0 && r.passed !== 1))
    throw new Error('Pass outcomes are required')
  const bars = models.map((key) => {
    const rs = selected.filter((r) => r.modelShort === key)
    let value: number | null = null
    const costsComplete = rs.every((r) => finite(r.costUsd))
    let timeout = 0
    if (settings.preset === 'completed') value = rs.filter((r) => r.passed === 1).length
    if (settings.preset === 'completion') value = completionRate(rs)
    if (settings.preset === 'total-cost' && costsComplete)
      value = rs.reduce((n, r) => n + r.costUsd!, 0)
    if (settings.preset === 'cost-per-success' && costsComplete) value = costPerSuccess(rs)
    if (
      settings.preset === 'median-time' &&
      rs.filter((r) => r.passed).every((r) => finite(r.agentSeconds))
    )
      value = medianTimePassed(rs)
    if (settings.preset === 'slow-timeouts') {
      if (rs.some((r) => r.timedOut !== 0 && r.timedOut !== 1))
        throw new Error('Agent timeout status is required')
      if (
        rs.some((r) => r.error && /timeout/i.test(r.error) && !/^AgentTimeoutError$/.test(r.error))
      )
        throw new Error('Unclassified timeout phase; normalize agent timeouts before charting')
      if (rs.some((r) => !r.timedOut && !finite(r.agentSeconds)))
        throw new Error('Agent duration is missing; unknown timing cannot be counted as fast')
      timeout = rs.filter((r) => r.timedOut === 1).length
      value = rs.filter((r) => r.timedOut === 1 || r.agentSeconds! > 300).length
    }
    if (value === null && settings.preset !== 'disagreement')
      warnings.push(
        key +
          ': unavailable ' +
          SOCIAL_PRESETS[settings.preset].label.toLowerCase() +
          ' (missing eligible data).',
      )
    return { key, value, timeout, n: rs.length }
  })
  let allPassed = 0,
    allFailed = 0
  const matrix = tasks.flatMap((task) => {
    const values = models.map(
      (m) => selected.find((r) => r.task === task && r.modelShort === m)!.passed,
    )
    if (values.every((v) => v === 1)) {
      allPassed++
      return []
    }
    if (values.every((v) => v === 0)) {
      allFailed++
      return []
    }
    return [{ task, values }]
  })
  if (settings.preset !== 'disagreement')
    bars.sort(
      (a, b) =>
        (b.value ?? -Infinity) - (a.value ?? -Infinity) ||
        models.indexOf(a.key) - models.indexOf(b.key),
    )
  const title =
    settings.preset === 'total-cost'
      ? 'Total cost across ' + tasks.length + ' tasks'
      : settings.preset === 'disagreement'
        ? matrix.length + ' tasks where models differed'
        : SOCIAL_PRESETS[settings.preset].label
  return {
    preset: settings.preset,
    title,
    tasks: tasks.length,
    bars,
    warnings,
    matrix,
    allPassed,
    allFailed,
  }
}
