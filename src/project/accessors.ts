import { DEFAULT_STATE, type ChartState, type ChartField } from '../charts/recipes'
import { DIMENSIONS, DIMENSION_LABEL, MEASURE_LABEL, type Dimension, type Measure, type TrialRow } from '../charts/trial'
import type { CommonDimensionSemantic, CommonMetricSemantic, EvaluationArtifact, FieldMappings, HevalProject, ProjectSource, FieldDefinition, Presentation, AnalysisView } from './schema'

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
    for (const definition of artifact.fields) {
      const value = record.values[definition.id]
      const key = fieldKey(definition, source.mappings)
      row[key] = definition.kind === 'metric' ? (typeof value === 'boolean' ? Number(value) : number(value)) : value
    }
    for (const [field, value] of Object.entries(record.values)) {
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
  const wanted = new Set(sourceIds)
  const sourceIdsOut: string[] = []
  const incompatible: string[] = []
  let signature: string | null = null
  for (const source of project.sources.filter((item) => wanted.has(item.id))) {
    const artifact = artifacts.get(source.artifactId)
    const map = artifact ? semantics(artifact, source.mappings) : new Map<string, string>()
    const field = artifact?.fields.find((candidate) => candidate.kind === 'metric' && fieldKey(candidate, source.mappings) === measure)
    const currentSignature = field ? `${map.get(field.id) ?? measure}|${field.valueType}|${field.unit ?? ''}` : null
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

/** Unknown semantics stay distinct from canonical Heval fields. */
export function fieldKey(field: FieldDefinition, mappings?: FieldMappings): string {
  const semantic = mappings?.dimensions?.[field.id] ?? mappings?.metrics?.[field.id] ?? field.semantic
  const known = field.kind === 'dimension' ? DIMENSION_KEY : METRIC_KEY
  return semantic && Object.hasOwn(known, semantic)
    ? String(known[semantic as keyof typeof known])
    : `custom:${encodeURIComponent(semantic ?? field.id).replaceAll('.', '%2E')}`
}

export function projectFields(project: HevalProject, artifacts: Map<string, EvaluationArtifact>, sourceIds: string[]): ChartField[] {
  const fields = new Map<string, ChartField>()
  for (const source of project.sources.filter((item) => sourceIds.includes(item.id))) {
    for (const field of artifacts.get(source.artifactId)?.fields ?? []) {
      const key = fieldKey(field, source.mappings)
      if (!fields.has(key)) fields.set(key, { key, label: MEASURE_LABEL[key] ?? DIMENSION_LABEL[key] ?? field.label, kind: field.kind, unit: field.unit, direction: field.direction })
    }
  }
  for (const key of DIMENSIONS.filter((key) => ['source', 'run', 'benchmark', 'benchmarkVersion', 'dataset', 'datasetVersion', 'iteration'].includes(key))) {
    fields.set(key, { key, label: DIMENSION_LABEL[key], kind: 'dimension' })
  }
  return [...fields.values()]
}

export function presentationAnalysis(project: HevalProject, presentation: Presentation): AnalysisView | null {
  return presentation.analysisSnapshot ?? project.analysisViews.find((item) => item.id === presentation.analysisViewId) ?? null
}

/** Pin legacy presentations on import, after checking the original bundle hash. */
export function snapshotPresentations(project: HevalProject): HevalProject {
  return { ...project, presentations: project.presentations.map((presentation) => {
    const view = presentationAnalysis(project, presentation)
    return { ...presentation, analysisSnapshot: view ? structuredClone(view) : undefined }
  }) }
}
