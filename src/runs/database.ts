// The homepage run database: published study trials, one record per attempt.
// scripts/build-run-database.ts writes run-database.json from results/harbor/.

export type RunStack = {
  id: string
  harness: string
  harnessName: string
  harnessVersion: string | null
  model: string
  modelName: string
  provider: string
  reasoningEffort: string | null
  thinking: string | null
}

export type RunTask = { id: string; name: string; repository: string | null; url: string | null }

export type RunTrial = {
  id: string
  task: string
  stack: string
  passed: boolean
  reward: number | null
  error: string | null
  agentSeconds: number | null
  totalSeconds: number | null
  inputTokens: number | null
  cacheTokens: number | null
  outputTokens: number | null
  tokenSource: 'gateway' | 'harness' | null
  costUsd: number | null
  costSource: string | null
  turns: number | null
  turnSource: string | null
  turnCap: number | null
  modelRequests: number | null
  startedAt: string | null
}

export type RunStudy = {
  id: string
  name: string
  summary: string
  varies: 'model' | 'harness'
  notes: string[]
  featured: [string, string]
  published: { label: string; url: string }
  report: { job: string; generatedAt: string }
  stacks: RunStack[]
  tasks: RunTask[]
  trials: RunTrial[]
}

export type RunDatabase = { schemaVersion: 1; studies: RunStudy[] }

export type Pair = [RunTrial, RunTrial | null]

const ERRORS: Record<string, string> = {
  AgentTimeoutError: 'Timed out',
  NonZeroAgentExitCodeError: 'Agent exited with an error',
  NetworkConnectionError: 'Network error',
  ApiRateLimitError: 'Rate limited',
}

export const errorLabel = (error: string | null) => error ? ERRORS[error] ?? error : null

/** Outcome as a reader sees it: the verifier result, or why the attempt stopped. */
export const outcome = (trial: RunTrial) => trial.passed ? 'Passed' : trial.error === 'AgentTimeoutError' ? 'Timed out' : 'Failed'

export const stackLabel = (study: RunStudy, stack: RunStack) => study.varies === 'model' ? stack.modelName : stack.harnessName

export function formatDuration(seconds: number | null) {
  if (seconds === null) return 'not recorded'
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600), m = Math.floor(total / 60) % 60, s = total % 60
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m) return `${m}m ${String(s).padStart(2, '0')}s`
  return `${s}s`
}

export function formatCost(usd: number | null) {
  if (usd === null) return 'not recorded'
  if (usd > 0 && usd < .01) return '<$0.01'
  return `$${usd.toFixed(2)}`
}

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
export const formatTokens = (tokens: number | null) => tokens === null ? 'not recorded' : compact.format(tokens)

export const passCount = (study: RunStudy, filter: (trial: RunTrial) => boolean) =>
  study.trials.filter(trial => trial.passed && filter(trial)).length

/** Stacks with the most passes first; tasks most often solved first, so the grid reads as a gradient. */
export function orderedStacks(study: RunStudy) {
  const passes = new Map(study.stacks.map(stack => [stack.id, passCount(study, trial => trial.stack === stack.id)]))
  return [...study.stacks].sort((a, b) => passes.get(b.id)! - passes.get(a.id)! || stackLabel(study, a).localeCompare(stackLabel(study, b)))
}

export function orderedTasks(study: RunStudy) {
  const solved = new Map(study.tasks.map(task => [task.id, passCount(study, trial => trial.task === task.id)]))
  return [...study.tasks].sort((a, b) => solved.get(b.id)! - solved.get(a.id)! || a.name.localeCompare(b.name))
}

export const trialAt = (study: RunStudy, task: string, stack: string) =>
  study.trials.find(trial => trial.task === task && trial.stack === stack) ?? null

/** The study's headline contrast on the first task where it shows: the first featured stack passed, the second did not. */
export function defaultPair(study: RunStudy): Pair {
  const [winner, loser] = study.featured
  for (const task of orderedTasks(study)) {
    const a = trialAt(study, task.id, winner), b = trialAt(study, task.id, loser)
    if (a?.passed && b && !b.passed) return [a, b]
  }
  return [study.trials[0], study.trials[1] ?? null]
}

export type Difference = { label: string; a: string; b: string }

/** What a comparison held constant and what it changed, in the reader's terms. */
export function compareSetup(study: RunStudy, a: RunTrial, b: RunTrial) {
  const stackA = study.stacks.find(stack => stack.id === a.stack)!
  const stackB = study.stacks.find(stack => stack.id === b.stack)!
  const taskName = (id: string) => study.tasks.find(task => task.id === id)?.name ?? id
  const harness = (stack: RunStack) => [stack.harnessName, stack.harnessVersion].filter(Boolean).join(' ')
  const fields: Difference[] = [
    { label: 'Task', a: taskName(a.task), b: taskName(b.task) },
    { label: 'Harness', a: harness(stackA), b: harness(stackB) },
    { label: 'Model', a: stackA.modelName, b: stackB.modelName },
    { label: 'Reasoning effort', a: stackA.reasoningEffort ?? 'not recorded', b: stackB.reasoningEffort ?? 'not recorded' },
    { label: 'Thinking setting', a: stackA.thinking ?? 'not recorded', b: stackB.thinking ?? 'not recorded' },
  ]
  const recorded = (field: Difference) => field.a !== 'not recorded' && field.b !== 'not recorded'
  return {
    constant: fields.filter(field => recorded(field) && field.a === field.b),
    changed: fields.filter(field => recorded(field) && field.a !== field.b),
    unknown: fields.filter(field => !recorded(field) && (field.a !== 'not recorded' || field.b !== 'not recorded')),
  }
}

/** Selection lives in the URL so a comparison can be shared: ?study=…&a=…&b=… */
export function readSelection(database: RunDatabase, search: string): { study: RunStudy; pair: Pair } {
  const params = new URLSearchParams(search)
  const study = database.studies.find(item => item.id === params.get('study')) ?? database.studies[0]
  const find = (id: string | null) => id ? study.trials.find(trial => trial.id === id) ?? null : null
  const a = find(params.get('a'))
  if (!a) return { study, pair: defaultPair(study) }
  const b = find(params.get('b'))
  return { study, pair: [a, b && b.id !== a.id ? b : null] }
}

export function selectionSearch(study: RunStudy, pair: Pair, current = '') {
  const params = new URLSearchParams(current)
  params.set('study', study.id)
  params.set('a', pair[0].id)
  if (pair[1]) params.set('b', pair[1].id)
  else params.delete('b')
  return `?${params}`
}
