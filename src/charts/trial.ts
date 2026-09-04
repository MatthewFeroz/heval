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
  /**
   * Who *made* the model - the slug prefix, e.g. `zai` in `zai/glm-5.3-flash`.
   * Not who served it: see `vendor`, which can hold the same string and mean
   * something entirely different.
   */
  provider: string | null
  /**
   * Who *served* the request, e.g. `particle`. Read from the `HEVAL_VENDOR` the
   * job pinned through the proxy; null when the run left routing to the gateway,
   * in which case the vendor is unknown and the timings are not comparable
   * across trials.
   */
  vendor: string | null
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
  /**
   * Agent step ran past `SLOW_TRIAL_SECONDS`. Stored as 0/1 so `mean` is a rate
   * and `sum` is a count. A trial killed by the harness cap is over the line by
   * definition, so timeouts are counted here too - the two measures overlap.
   */
  overSlow: 0 | 1
  /** Harbor killed the agent step at the task's cap. Subset of `overSlow`. */
  timedOut: 0 | 1
  inputTokens: number | null
  cacheTokens: number | null
  outputTokens: number | null
  /** Input + output. Cache reads are excluded so cost-per-token stays meaningful. */
  totalTokens: number | null
  /** Cost in USD, however it was obtained. Null when neither route works. */
  costUsd: number | null
  /**
   * How `costUsd` was obtained. `reported` is the harness's own figure;
   * `derived` is token counts priced against the gateway catalog, which is how
   * Codex gets a cost at all (Harbor prices it via LiteLLM, which does not know
   * these slugs). Mixing the two in one comparison is defensible; hiding which
   * is which is not.
   */
  costSource: 'reported' | 'derived' | null
  startedAt: string | null
  /** Harbor exception type when the trial errored, else null. */
  error: string | null
  /** Project source label. Added by the Studio adapter; absent in JobExport v1. */
  source?: string
  /** Immutable run label. Added by the Studio adapter. */
  run?: string
  /** Benchmark identity carried by a self-describing evaluation artifact. */
  benchmark?: string
  benchmarkVersion?: string
  dataset?: string
  datasetVersion?: string
  /** Deliberately distinct from a run id or benchmark version. */
  iteration?: string | null
  /** Artifact-declared fields are projected here under stable `custom:` keys. */
  [field: string]: string | number | boolean | null | undefined
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
export const DIMENSIONS = [
  'agent', 'model', 'modelShort', 'task', 'stack', 'provider', 'vendor', 'agentVersion',
  'source', 'run', 'benchmark', 'benchmarkVersion', 'dataset', 'datasetVersion', 'iteration',
] as const
export type CoreDimension = (typeof DIMENSIONS)[number]
export type Dimension = string

/**
 * Tail-latency threshold, seconds. A trial whose agent step runs longer counts
 * toward `overSlow`. Five minutes because that is the line the published
 * cross-model comparisons draw, so our numbers stay readable against theirs.
 */
export const SLOW_TRIAL_SECONDS = 300

/** Measures a chart can aggregate. */
export const MEASURES = [
  'passed',
  'reward',
  'costUsd',
  'agentSeconds',
  'totalSeconds',
  'overSlow',
  'timedOut',
  'inputTokens',
  'cacheTokens',
  'outputTokens',
  'totalTokens',
] as const
export type CoreMeasure = (typeof MEASURES)[number]
export type Measure = string

export const DIMENSION_LABEL: Record<string, string> = {
  agent: 'Harness',
  model: 'Model',
  modelShort: 'Model (short)',
  task: 'Task',
  stack: 'Stack (harness / model)',
  provider: 'Model creator',
  vendor: 'Serving vendor',
  agentVersion: 'Harness version',
  source: 'Project source',
  run: 'Run',
  benchmark: 'Benchmark',
  benchmarkVersion: 'Benchmark version',
  dataset: 'Dataset',
  datasetVersion: 'Dataset version',
  iteration: 'Iteration',
}

export const MEASURE_LABEL: Record<string, string> = {
  passed: 'Pass rate',
  reward: 'Reward',
  costUsd: 'Cost (USD)',
  agentSeconds: 'Agent time (s)',
  totalSeconds: 'Total trial time (s)',
  overSlow: `Over ${SLOW_TRIAL_SECONDS / 60} min`,
  timedOut: 'Timeout rate',
  inputTokens: 'Input tokens',
  cacheTokens: 'Cache read tokens',
  outputTokens: 'Output tokens',
  totalTokens: 'Total tokens',
}

/** Vega-Lite axis format per measure. */
export const MEASURE_FORMAT: Record<string, string> = {
  passed: '.0%',
  reward: '.0%',
  costUsd: '$.2f',
  agentSeconds: '.0f',
  totalSeconds: '.0f',
  // Rates like `passed`: correct under the default `mean`, wrong if summed.
  overSlow: '.0%',
  timedOut: '.0%',
  inputTokens: '~s',
  cacheTokens: '~s',
  outputTokens: '~s',
  totalTokens: '~s',
}
