import { socialSettings, type SocialSettings } from '../charts/social-presets'
import { DEFAULT_STATE, type ChartState } from '../charts/recipes'
import { COMPLETION_DEFAULTS, type CanvasId, type CompletionOptions } from '../charts/motion-options'
import { PRESENTATION_DEFAULT_SOURCE } from '../charts/presentation-defaults'
import { DEFAULT_THEME, type ThemeId } from '../charts/motion-themes'
import type { JobExport, Measure, TrialRow } from '../charts/trial'

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export const EVALUATION_SCHEMA_VERSION = 2 as const
export const PROJECT_SCHEMA_VERSION = 1 as const
export const BUNDLE_SCHEMA_VERSION = 1 as const
export const RENDERER_VERSION = 'heval-studio/0.2' as const

export type CommonDimensionSemantic =
  | 'heval.trial'
  | 'heval.task'
  | 'heval.task.full'
  | 'heval.task.checksum'
  | 'heval.agent'
  | 'heval.agent.version'
  | 'heval.model'
  | 'heval.model.short'
  | 'heval.model.provider'
  | 'heval.model.vendor'
  | 'heval.stack'
  | 'heval.started_at'

export type CommonMetricSemantic =
  | 'heval.reward'
  | 'heval.passed'
  | 'heval.duration.agent_seconds'
  | 'heval.duration.total_seconds'
  | 'heval.duration.over_slow'
  | 'heval.timeout'
  | 'heval.tokens.input'
  | 'heval.tokens.cache'
  | 'heval.tokens.output'
  | 'heval.tokens.total'
  | 'heval.cost.usd'

export type FieldDefinition = {
  id: string
  label: string
  kind: 'dimension' | 'metric'
  valueType: 'string' | 'number' | 'boolean' | 'timestamp'
  semantic?: CommonDimensionSemantic | CommonMetricSemantic | string
  unit?: 'ratio' | 'seconds' | 'tokens' | 'usd' | 'count' | string
  direction?: 'higher' | 'lower' | 'neutral'
  description?: string
}

export type ArtifactRecord = {
  id: string
  values: Record<string, JsonPrimitive>
  raw?: JsonValue
  reference?: string
}

export type RecommendedView = {
  id: string
  label: string
  chart: Partial<ChartState>
  narrative?: string
}

export type EvaluationArtifact = {
  artifactType: 'heval-evaluation'
  schemaVersion: typeof EVALUATION_SCHEMA_VERSION
  id: string
  contentHash: string
  label: string
  benchmark: { id: string; label: string; version: string }
  dataset: { id: string; label: string; version: string; contentHash?: string }
  run: {
    id: string
    label: string
    status: 'in-progress' | 'complete' | 'failed' | 'cancelled' | 'unknown'
    iteration?: number
    parentRunId?: string
    changes?: string[]
    startedAt?: string
    finishedAt?: string
  }
  generatedAt: string
  config: Record<string, JsonValue>
  fields: FieldDefinition[]
  records: ArtifactRecord[]
  recommendedViews: RecommendedView[]
  provenance: {
    adapter: string
    source?: string
    sourceSchemaVersion?: number
    rendererVersion: string
  }
}

export type FieldMappings = {
  dimensions?: Record<string, CommonDimensionSemantic>
  metrics?: Record<string, CommonMetricSemantic>
}

export type ProjectSource = {
  id: string
  label: string
  uri: string
  artifactId: string
  runId: string
  contentHash: string
  mappings?: FieldMappings
}

export type AnalysisFilter = { field: string; values: string[] }

export type AnalysisView = {
  id: string
  label: string
  sourceIds: string[]
  chart: ChartState
  customSpec?: string | null
  filters: AnalysisFilter[]
  createdAt: string
  updatedAt: string
}

export type Presentation = {
  id: string
  label: string
  revision: number
  parentPresentationId?: string
  analysisViewId: string
  analysisSnapshot?: AnalysisView
  customSpec?: string | null
  snapshotPins: { sourceId: string; artifactId: string; runId: string; contentHash: string }[]
  theme: ThemeId
  canvas: CanvasId
  narrative: { title: string; kicker: string; cue: string; note: string; source: string }
  graphOverrides: Partial<ChartState>
  social?: SocialSettings
  motion: CompletionOptions
  renderer: {
    version: string
    evaluationSchemaVersion: number
    projectSchemaVersion: number
  }
  createdAt: string
  updatedAt: string
}

export type HevalProject = {
  artifactType: 'heval-project'
  schemaVersion: typeof PROJECT_SCHEMA_VERSION
  id: string
  label: string
  createdAt: string
  updatedAt: string
  sources: ProjectSource[]
  analysisViews: AnalysisView[]
  presentations: Presentation[]
}

export type HevalBundle = {
  artifactType: 'heval-bundle'
  schemaVersion: typeof BUNDLE_SCHEMA_VERSION
  contentHash: string
  createdAt: string
  project: HevalProject
  artifacts: EvaluationArtifact[]
}

export class HevalSchemaError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HevalSchemaError'
  }
}

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const string = (value: unknown, at: string) => {
  if (typeof value !== 'string' || !value) throw new HevalSchemaError(`${at} must be a non-empty string`)
  return value
}
const array = (value: unknown, at: string) => {
  if (!Array.isArray(value)) throw new HevalSchemaError(`${at} must be an array`)
  return value
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (!isObject(value)) return value
  return Object.fromEntries(Object.keys(value).filter((key) => key !== 'contentHash').sort().map((key) => [key, canonical(value[key])]))
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(canonical(value))
}

export async function contentHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(stableStringify(value))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

export async function verifyContentHash(value: { contentHash: string }): Promise<boolean> {
  return value.contentHash === await contentHash(value)
}

const DIMENSION_FIELDS: FieldDefinition[] = [
  ['trial', 'Trial', 'heval.trial'],
  ['task', 'Task', 'heval.task'],
  ['taskFull', 'Task (full)', 'heval.task.full'],
  ['taskChecksum', 'Task checksum', 'heval.task.checksum'],
  ['agent', 'Harness', 'heval.agent'],
  ['agentVersion', 'Harness version', 'heval.agent.version'],
  ['model', 'Model', 'heval.model'],
  ['modelShort', 'Model (short)', 'heval.model.short'],
  ['provider', 'Model creator', 'heval.model.provider'],
  ['vendor', 'Serving vendor', 'heval.model.vendor'],
  ['stack', 'Stack', 'heval.stack'],
  ['startedAt', 'Started', 'heval.started_at'],
].map(([id, label, semantic]) => ({ id, label, semantic, kind: 'dimension', valueType: id === 'startedAt' ? 'timestamp' : 'string' })) as FieldDefinition[]

const METRIC_FIELDS: FieldDefinition[] = [
  ['reward', 'Reward', 'heval.reward', 'ratio', 'higher'],
  ['passed', 'Pass rate', 'heval.passed', 'ratio', 'higher'],
  ['agentSeconds', 'Agent time', 'heval.duration.agent_seconds', 'seconds', 'lower'],
  ['totalSeconds', 'Total time', 'heval.duration.total_seconds', 'seconds', 'lower'],
  ['overSlow', 'Over slow threshold', 'heval.duration.over_slow', 'ratio', 'lower'],
  ['timedOut', 'Timeout', 'heval.timeout', 'ratio', 'lower'],
  ['inputTokens', 'Input tokens', 'heval.tokens.input', 'tokens', 'lower'],
  ['cacheTokens', 'Cache tokens', 'heval.tokens.cache', 'tokens', 'neutral'],
  ['outputTokens', 'Output tokens', 'heval.tokens.output', 'tokens', 'lower'],
  ['totalTokens', 'Total tokens', 'heval.tokens.total', 'tokens', 'lower'],
  ['costUsd', 'Cost', 'heval.cost.usd', 'usd', 'lower'],
].map(([id, label, semantic, unit, direction]) => ({ id, label, semantic, unit, direction, kind: 'metric', valueType: 'number' })) as FieldDefinition[]

const ROW_KEYS = [...DIMENSION_FIELDS, ...METRIC_FIELDS].map((field) => field.id) as (keyof TrialRow)[]

function jobRecord(row: TrialRow): ArtifactRecord {
  const values: Record<string, JsonPrimitive> = {}
  for (const key of ROW_KEYS) {
    const value = row[key]
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) values[key] = value
  }
  values.costSource = row.costSource
  values.error = row.error
  return { id: row.trial, values }
}

export async function adaptJobExportV1(exp: JobExport, uri = ''): Promise<EvaluationArtifact> {
  if (!isObject(exp) || exp.schemaVersion !== 1 || !Array.isArray(exp.rows)) throw new HevalSchemaError('Expected a Heval JobExport schemaVersion 1')
  const taskChecksums = [...new Set(exp.rows.map((row) => row.taskChecksum).filter(Boolean))].sort()
  const started = exp.rows.map((row) => row.startedAt).filter((value): value is string => !!value).sort()[0]
  const artifact: EvaluationArtifact = {
    artifactType: 'heval-evaluation',
    schemaVersion: EVALUATION_SCHEMA_VERSION,
    // A run can be exported while it is still progressing. Keep every exported
    // snapshot distinct from the durable run id so later rows cannot replace it.
    id: `job:${exp.jobId ?? exp.job}@${exp.generatedAt}`,
    contentHash: '',
    label: exp.job,
    benchmark: { id: 'harbor', label: 'Harbor evaluation', version: 'unknown' },
    dataset: {
      id: [...new Set(exp.rows.map((row) => row.taskFull.split('/')[0]))].length === 1 ? exp.rows[0]?.taskFull.split('/')[0] || 'unknown' : 'mixed',
      label: 'Legacy JobExport dataset',
      version: 'unknown',
      contentHash: taskChecksums.length ? await contentHash(taskChecksums) : undefined,
    },
    run: { id: exp.jobId ?? exp.job, label: exp.job, status: 'unknown', startedAt: started },
    generatedAt: exp.generatedAt,
    config: { legacySource: exp.source, agentVersions: exp.agentVersions as unknown as JsonValue },
    fields: [...DIMENSION_FIELDS, ...METRIC_FIELDS],
    records: exp.rows.map(jobRecord),
    recommendedViews: [
      { id: 'pass-rate', label: 'Pass rate', chart: { recipe: 'bar', x: 'agent', color: 'modelShort', measure: 'passed', aggregate: 'mean' } },
      { id: 'quality-cost', label: 'Quality versus cost', chart: { recipe: 'scatter', x: 'stack', color: 'modelShort', measure: 'passed', xMeasure: 'costUsd' } },
      { id: 'per-task', label: 'Per-task matrix', chart: { recipe: 'matrix', x: 'stack', row: 'task', measure: 'passed' } },
    ],
    provenance: { adapter: 'heval/job-export-v1', source: uri || exp.source, sourceSchemaVersion: 1, rendererVersion: RENDERER_VERSION },
  }
  artifact.contentHash = await contentHash(artifact)
  return artifact
}

export function parseEvaluationArtifact(value: unknown): EvaluationArtifact {
  if (!isObject(value) || value.artifactType !== 'heval-evaluation' || value.schemaVersion !== EVALUATION_SCHEMA_VERSION) throw new HevalSchemaError('Expected a heval-evaluation schemaVersion 2 artifact')
  string(value.id, 'artifact.id')
  string(value.contentHash, 'artifact.contentHash')
  if (!isObject(value.run)) throw new HevalSchemaError('artifact.run must be an object')
  string(value.run.id, 'artifact.run.id')
  array(value.fields, 'artifact.fields')
  array(value.records, 'artifact.records')
  return value as EvaluationArtifact
}

export function parseProject(value: unknown): HevalProject {
  if (!isObject(value) || value.artifactType !== 'heval-project' || value.schemaVersion !== PROJECT_SCHEMA_VERSION) throw new HevalSchemaError('Expected a .heval-project.json schemaVersion 1 file')
  string(value.id, 'project.id')
  string(value.label, 'project.label')
  array(value.sources, 'project.sources')
  array(value.analysisViews, 'project.analysisViews')
  array(value.presentations, 'project.presentations')
  for (const [index, source] of (value.sources as unknown[]).entries()) {
    if (!isObject(source)) throw new HevalSchemaError(`project.sources[${index}] must be an object`)
    string(source.contentHash, `project.sources[${index}].contentHash`)
    string(source.uri, `project.sources[${index}].uri`)
  }
  for (const view of value.analysisViews as AnalysisView[]) validateCustomSpec(view.customSpec)
  for (const presentation of value.presentations as Presentation[]) {
    if (presentation.social !== undefined) socialSettings(presentation.social)
    validateCustomSpec(presentation.customSpec)
    if (presentation.analysisSnapshot) validateCustomSpec(presentation.analysisSnapshot.customSpec)
  }
  return value as HevalProject
}

export function parseBundle(value: unknown): HevalBundle {
  if (!isObject(value) || value.artifactType !== 'heval-bundle' || value.schemaVersion !== BUNDLE_SCHEMA_VERSION) throw new HevalSchemaError('Expected a .heval-bundle.json schemaVersion 1 file')
  string(value.contentHash, 'bundle.contentHash')
  parseProject(value.project)
  for (const artifact of array(value.artifacts, 'bundle.artifacts')) parseEvaluationArtifact(artifact)
  return value as HevalBundle
}

export async function sourceFromArtifact(artifact: EvaluationArtifact, uri: string): Promise<ProjectSource> {
  if (!artifact.contentHash) artifact.contentHash = await contentHash(artifact)
  return { id: `source:${artifact.id}`, label: artifact.label, uri, artifactId: artifact.id, runId: artifact.run.id, contentHash: artifact.contentHash }
}

export function newProject(source: ProjectSource, artifact: EvaluationArtifact): HevalProject {
  const now = new Date().toISOString()
  const view: AnalysisView = {
    id: crypto.randomUUID(),
    label: artifact.recommendedViews[0]?.label ?? 'Analysis 1',
    sourceIds: [source.id],
    chart: { ...DEFAULT_STATE, ...(artifact.recommendedViews[0]?.chart ?? {}) },
    filters: [],
    createdAt: now,
    updatedAt: now,
  }
  return { artifactType: 'heval-project', schemaVersion: PROJECT_SCHEMA_VERSION, id: crypto.randomUUID(), label: artifact.label, createdAt: now, updatedAt: now, sources: [source], analysisViews: [view], presentations: [] }
}

export function newPresentation(project: HevalProject, view: AnalysisView): Presentation {
  const now = new Date().toISOString()
  const sourceById = new Map(project.sources.map((source) => [source.id, source]))
  return {
    id: crypto.randomUUID(),
    label: `${view.label} presentation`,
    revision: 1,
    analysisViewId: view.id,
    analysisSnapshot: structuredClone(view),
    customSpec: view.customSpec ?? null,
    snapshotPins: view.sourceIds.map((id) => sourceById.get(id)).filter((source): source is ProjectSource => !!source).map((source) => ({ sourceId: source.id, artifactId: source.artifactId, runId: source.runId, contentHash: source.contentHash })),
    theme: DEFAULT_THEME,
    social: socialSettings(undefined),
    canvas: COMPLETION_DEFAULTS.canvas,
    narrative: { title: '', kicker: '', cue: '', note: '', source: '' },
    graphOverrides: { theme: 'light' },
    motion: { ...COMPLETION_DEFAULTS, source: PRESENTATION_DEFAULT_SOURCE },
    renderer: { version: RENDERER_VERSION, evaluationSchemaVersion: EVALUATION_SCHEMA_VERSION, projectSchemaVersion: PROJECT_SCHEMA_VERSION },
    createdAt: now,
    updatedAt: now,
  }
}

export async function makeBundle(project: HevalProject, artifacts: EvaluationArtifact[]): Promise<HevalBundle> {
  const bundle: HevalBundle = { artifactType: 'heval-bundle', schemaVersion: BUNDLE_SCHEMA_VERSION, contentHash: '', createdAt: new Date().toISOString(), project, artifacts }
  bundle.contentHash = await contentHash(bundle)
  return bundle
}

export function metricSemantic(measure: Measure): CommonMetricSemantic {
  return METRIC_FIELDS.find((field) => field.id === measure)?.semantic as CommonMetricSemantic
}

/** Validate persisted JSON without requiring a browser or mutating the document. */
export function validateCustomSpec(spec: unknown): void {
  if (spec === undefined || spec === null) return
  if (typeof spec !== 'string') throw new HevalSchemaError('Custom spec must be JSON text')
  let parsed: unknown
  try { parsed = JSON.parse(spec) } catch { throw new HevalSchemaError('Custom spec must contain valid JSON') }
  if (!isObject(parsed)) throw new HevalSchemaError('Custom spec must be a JSON object')
}
