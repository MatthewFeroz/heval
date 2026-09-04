import { DEFAULT_STATE, type ChartState } from '../charts/recipes'
import type { Dimension, Measure, TrialRow } from '../charts/trial'
import type { CommonDimensionSemantic, CommonMetricSemantic, EvaluationArtifact, FieldMappings, HevalProject, ProjectSource } from './schema'
import { metricSemantic } from './schema'

const DIMENSION_KEY: Record<CommonDimensionSemantic, keyof TrialRow> = {
  'heval.trial': 'trial',
  'heval.task': 'task',
  'heval.task.full': 'taskFull',
  'heval.task.checksum': 'taskChecksum',
  'heval.agent': 'agent',
  'heval.agent.version': 'agentVersion',
  'heval.model': 'model',
  'heval.model.short': 'modelShort',
  'heval.model.provider': 'provider',
  'heval.model.vendor': 'vendor',
  'heval.stack': 'stack',
  'heval.started_at': 'startedAt',
}

const METRIC_KEY: Record<CommonMetricSemantic, keyof TrialRow> = {
  'heval.reward': 'reward',
  'heval.passed': 'passed',
  'heval.duration.agent_seconds': 'agentSeconds',
  'heval.duration.total_seconds': 'totalSeconds',
  'heval.duration.over_slow': 'overSlow',
  'heval.timeout': 'timedOut',
  'heval.tokens.input': 'inputTokens',
  'heval.tokens.cache': 'cacheTokens',
  'heval.tokens.output': 'outputTokens',
  'heval.tokens.total': 'totalTokens',
  'heval.cost.usd': 'costUsd',
}

function semantics(artifact: EvaluationArtifact, mappings?: FieldMappings): Map<string, string> {
  const map = new Map(artifact.fields.filter((field) => field.semantic).map((field) => [field.id, field.semantic!]))
  for (const [field, semantic] of Object.entries(mappings?.dimensions ?? {})) map.set(field, semantic)
  for (const [field, semantic] of Object.entries(mappings?.metrics ?? {})) map.set(field, semantic)
  return map
}

const text = (value: unknown, fallback: string) => typeof value === 'string' && value ? value : fallback
const number = (value: unknown, fallback: number | null = null) => typeof value === 'number' && Number.isFinite(value) ? value : fallback

export function artifactRows(artifact: EvaluationArtifact, source: ProjectSource): TrialRow[] {
  const map = semantics(artifact, source.mappings)
  return artifact.records.map((record): TrialRow => {
    const row: TrialRow = {
      trial: record.id,
      task: 'unknown', taskFull: 'unknown', taskChecksum: null,
      agent: 'unknown', agentVersion: null,
      model: 'unknown', modelShort: 'unknown', provider: null, vendor: null, stack: 'unknown / unknown',
      reward: 0, passed: 0,
      agentSeconds: null, totalSeconds: null, overSlow: 0, timedOut: 0,
      inputTokens: null, cacheTokens: null, outputTokens: null, totalTokens: null,
      costUsd: null, costSource: null, startedAt: null, error: null,
      source: source.label,
      run: artifact.run.label,
      benchmark: artifact.benchmark.label,
      benchmarkVersion: artifact.benchmark.version,
      dataset: artifact.dataset.label,
      datasetVersion: artifact.dataset.version,
      iteration: artifact.run.iteration === undefined ? null : String(artifact.run.iteration),
    }
    for (const [field, value] of Object.entries(record.values)) {
      const semantic = map.get(field)
      if (semantic && semantic in DIMENSION_KEY) (row as Record<string, unknown>)[DIMENSION_KEY[semantic as CommonDimensionSemantic]] = value
      if (semantic && semantic in METRIC_KEY) (row as Record<string, unknown>)[METRIC_KEY[semantic as CommonMetricSemantic]] = value
      if (field === 'costSource' && (value === 'reported' || value === 'derived')) row.costSource = value
      if (field === 'error') row.error = typeof value === 'string' ? value : null
    }
    row.trial = text(row.trial, record.id)
    row.task = text(row.task, 'unknown')
    row.taskFull = text(row.taskFull, row.task)
    row.agent = text(row.agent, 'unknown')
    row.model = text(row.model, 'unknown')
    row.modelShort = text(row.modelShort, row.model)
    row.stack = text(row.stack, `${row.agent} / ${row.modelShort}`)
    row.reward = number(row.reward, 0) ?? 0
    row.passed = (number(row.passed, 0) ?? 0) > 0 ? 1 : 0
    row.overSlow = (number(row.overSlow, 0) ?? 0) > 0 ? 1 : 0
    row.timedOut = (number(row.timedOut, 0) ?? 0) > 0 ? 1 : 0
    return row
  })
}

export function projectRows(project: HevalProject, artifacts: Map<string, EvaluationArtifact>, sourceIds: string[]): TrialRow[] {
  const wanted = new Set(sourceIds)
  const selected = project.sources.filter((source) => wanted.has(source.id))
  return selected.flatMap((source) => {
    const artifact = artifacts.get(source.artifactId)
    if (!artifact) return []
    const rows = artifactRows(artifact, source)
    return selected.length > 1 ? rows.map((row) => ({ ...row, trial: `${source.runId}:${row.trial}` })) : rows
  })
}

export function compatibleSources(project: HevalProject, artifacts: Map<string, EvaluationArtifact>, sourceIds: string[], measure: Measure): { sourceIds: string[]; incompatible: string[] } {
  const semantic = metricSemantic(measure)
  const wanted = new Set(sourceIds)
  const sourceIdsOut: string[] = []
  const incompatible: string[] = []
  let signature: string | null = null
  for (const source of project.sources.filter((item) => wanted.has(item.id))) {
    const artifact = artifacts.get(source.artifactId)
    const map = artifact ? semantics(artifact, source.mappings) : new Map<string, string>()
    const fieldId = [...map.entries()].find(([, mapped]) => mapped === semantic)?.[0]
    const field = artifact?.fields.find((candidate) => candidate.id === fieldId)
    const currentSignature = field ? `${semantic}|${field.valueType}|${field.unit ?? ''}` : null
    if (!artifact || !currentSignature || (signature !== null && currentSignature !== signature)) incompatible.push(source.label)
    else {
      signature ??= currentSignature
      sourceIdsOut.push(source.id)
    }
  }
  return { sourceIds: sourceIdsOut, incompatible }
}

export function presentationChart(viewChart: ChartState | undefined, overrides: Partial<ChartState>, title: string): ChartState {
  return { ...DEFAULT_STATE, ...(viewChart ?? {}), ...overrides, ...(title ? { title } : {}) }
}

export function dimensionsInRows(rows: TrialRow[], dimensions: readonly Dimension[]): Dimension[] {
  return dimensions.filter((dimension) => rows.some((row) => row[dimension] !== null && row[dimension] !== undefined && String(row[dimension]) !== 'unknown'))
}
