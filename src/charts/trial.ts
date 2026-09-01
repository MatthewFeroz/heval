/**
 * Normalized Harbor trial row.
 *
 * One row per trial, flattened from Harbor's per-trial `config.json` +
 * `result.json`. This is the single data shape the static report, the graph
 * editor, and any future export all consume, so a chart built in the editor
 * against one job renders identically against the next.
 *
 * Browser-safe: types only, no fs.
 */

export type TrialRow = {
  /** Harbor trial directory name, e.g. `66be7179…__X9ouJKE`. */
  trial: string
  /** Short task id, e.g. `fix-git`. */
  task: string
  /** Full Harbor task name, e.g. `terminal-bench/fix-git`. */
  taskFull: string
  /** Content digest of the task package - the pin that makes runs comparable. */
  taskChecksum: string | null
  /** Harness (Harbor agent name), e.g. `codex`, `claude-code`. */
  agent: string
  /** Harness version that actually ran inside the sandbox (from `agent_info`). */
  agentVersion: string | null
  /** Full model slug as configured, e.g. `zai/glm-5.3-flash`. */
  model: string
  /** Model without the vendor prefix, e.g. `glm-5.3-flash`. */
  modelShort: string
  /** Vendor prefix of the slug, e.g. `zai`, `anthropic`. */
  provider: string | null
  /** `agent / modelShort` - the unit the protocol calls a stack. */
  stack: string
  /** Verifier reward, 0..1. */
  reward: number
  /** `reward >= 1`. Stored as 0/1 so `mean(passed)` is a pass rate. */
  passed: 0 | 1
  /** Wall-clock of the agent step alone, seconds. */
  agentSeconds: number | null
  /** Environment build + agent setup + agent + verifier, seconds. */
  totalSeconds: number | null
  inputTokens: number | null
  cacheTokens: number | null
  outputTokens: number | null
  /** Input + output. Cache reads are excluded so cost-per-token stays meaningful. */
  totalTokens: number | null
  /** Provider-reported cost. Null when the gateway exposes no pricing. */
  costUsd: number | null
  startedAt: string | null
  /** Harbor exception type when the trial errored, else null. */
  error: string | null
}

export type JobExport = {
  schemaVersion: 1
  job: string
  /** Harbor job id (uuid) when present. */
  jobId: string | null
  generatedAt: string
  /** Absolute path the rows were read from; informational only. */
  source: string
  /** Harness -> version actually observed across trials (from `agent_info`). */
  agentVersions: Record<string, string[]>
  rows: TrialRow[]
}

export type JobIndexEntry = {
  job: string
  file: string
  generatedAt: string
  trials: number
  agents: string[]
  models: string[]
  tasks: string[]
}

export type JobIndex = {
  schemaVersion: 1
  jobs: JobIndexEntry[]
}

/** Dimensions a chart can group by. */
export const DIMENSIONS = ['agent', 'model', 'modelShort', 'task', 'stack', 'provider', 'agentVersion'] as const
export type Dimension = (typeof DIMENSIONS)[number]

/** Measures a chart can aggregate. */
export const MEASURES = [
  'passed',
  'reward',
  'costUsd',
  'agentSeconds',
  'totalSeconds',
  'inputTokens',
  'cacheTokens',
  'outputTokens',
  'totalTokens',
] as const
export type Measure = (typeof MEASURES)[number]

export const DIMENSION_LABEL: Record<Dimension, string> = {
  agent: 'Harness',
  model: 'Model',
  modelShort: 'Model (short)',
  task: 'Task',
  stack: 'Stack (harness / model)',
  provider: 'Provider',
  agentVersion: 'Harness version',
}

export const MEASURE_LABEL: Record<Measure, string> = {
  passed: 'Pass rate',
  reward: 'Reward',
  costUsd: 'Cost (USD)',
  agentSeconds: 'Agent time (s)',
  totalSeconds: 'Total trial time (s)',
  inputTokens: 'Input tokens',
  cacheTokens: 'Cache read tokens',
  outputTokens: 'Output tokens',
  totalTokens: 'Total tokens',
}

/** Vega-Lite axis format per measure. */
export const MEASURE_FORMAT: Record<Measure, string> = {
  passed: '.0%',
  reward: '.0%',
  costUsd: '$.2f',
  agentSeconds: '.0f',
  totalSeconds: '.0f',
  inputTokens: '~s',
  cacheTokens: '~s',
  outputTokens: '~s',
  totalTokens: '~s',
}
