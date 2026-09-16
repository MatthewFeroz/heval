import { adaptJobExportV1, sourceFromArtifact, type AnalysisView, type HevalProject, type Presentation } from '../project/schema'
import { presentationAnalysis, presentationChart, projectFields, projectRows } from '../project/accessors'
import { DEFAULT_STATE, buildChart, type ChartState } from '../charts/recipes'
import { DIMENSIONS, MEASURES } from '../charts/trial'
import { completionOptions } from '../charts/motion-options'
import type { ReportData } from './format'

export type ReportProject = { project: HevalProject; viewId: string; presentationId: string | null; mode: 'analysis' | 'presentation' }

export async function reportArtifact(data: ReportData, id: string) {
  return adaptJobExportV1({ ...data, jobId: id, source: '', agentVersions: {} }, `heval:report/${id}`)
}
export async function initialReportProject(data: ReportData, id: string, title: string): Promise<ReportProject> {
  const artifact = await reportArtifact(data, id)
  const source = await sourceFromArtifact(artifact, `heval:report/${id}`)
  const view: AnalysisView = { id: `view:${id}`, label: 'Completion', sourceIds: [source.id], chart: { ...DEFAULT_STATE, x: 'stack', color: 'none', theme: 'light', title: 'Completion by agent and model' }, filters: [], customSpec: null, createdAt: data.generatedAt, updatedAt: data.generatedAt }
  return { project: { artifactType: 'heval-project', schemaVersion: 1, id, label: title, createdAt: data.generatedAt, updatedAt: data.generatedAt, sources: [source], analysisViews: [view], presentations: [] }, viewId: view.id, presentationId: null, mode: 'analysis' }
}

const object = (v: unknown): Record<string, unknown> => { if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Invalid project object.'); return v as Record<string, unknown> }
function text(v: unknown, max = 256, empty = false): string { if (typeof v !== 'string' || (!empty && !v.trim()) || v.length > max) throw new Error('Invalid project text.'); return v }
function choice<T extends string>(v: unknown, values: readonly T[]): T { if (typeof v !== 'string' || !values.includes(v as T)) throw new Error('Invalid chart setting.'); return v as T }
function list(v: unknown, max: number): unknown[] { if (!Array.isArray(v) || v.length > max) throw new Error('Project has too many items or an invalid list.'); return v }
function chart(value: unknown, partial = false): ChartState {
  const input = object(value), result = { ...DEFAULT_STATE }
  const enums = { recipe: ['bar', 'scatter', 'strip', 'matrix'], x: DIMENSIONS, color: ['none', ...DIMENSIONS], facet: ['none', ...DIMENSIONS], row: DIMENSIONS, measure: MEASURES, xMeasure: MEASURES, aggregate: ['mean', 'median', 'sum', 'min', 'max'], sort: ['alpha', 'desc', 'asc'], theme: ['light', 'dark'] } as const
  for (const [key, values] of Object.entries(enums)) {
    if (partial && input[key] === undefined) continue
    Object.assign(result, { [key]: choice(input[key], values) })
  }
  for (const key of ['labels', 'intervals'] as const) {
    if (partial && input[key] === undefined) continue
    if (typeof input[key] !== 'boolean') throw new Error('Invalid chart toggle.')
    result[key] = input[key]
  }
  for (const key of ['title', 'subtitle', 'format'] as const) if (!partial || input[key] !== undefined) result[key] = text(input[key], key === 'format' ? 32 : 500, true)
  return result
}

/** Rebuild an allowlisted project. Imported data and source pins cannot be edited. */
export function validateReportProject(json: string, base: ReportProject): ReportProject {
  if (new TextEncoder().encode(json).length > 150_000) throw new Error('Project settings must be smaller than 150 KB.')
  const input = object(JSON.parse(json)), p = object(input.project)
  const source = base.project.sources[0]
  if (p.id !== base.project.id || JSON.stringify(p.sources) !== JSON.stringify(base.project.sources)) throw new Error('Evaluation data and source pins cannot be changed. Import a new report for different results.')
  const noSpec = (v: unknown) => { if (v !== undefined && v !== null) throw new Error('Hosted projects support chart controls. Custom Vega specs can be saved in local bundles.') }
  const view = (v: unknown): AnalysisView => {
    const item = object(v); noSpec(item.customSpec)
    const ids = list(item.sourceIds, 1).map(id => { if (id !== source.id) throw new Error('Unknown evaluation source.'); return source.id })
    return { id: text(item.id), label: text(item.label), sourceIds: ids, chart: chart(item.chart), customSpec: null,
      filters: list(item.filters, 20).map(f => { const filter = object(f); return { field: choice(filter.field, [...DIMENSIONS, 'trial', 'taskFull']), values: list(filter.values, 500).map(v => text(v, 256, true)) } }), createdAt: text(item.createdAt), updatedAt: text(item.updatedAt) }
  }
  const views = list(p.analysisViews, 20).map(view)
  if (!views.length || new Set(views.map(v => v.id)).size !== views.length) throw new Error('Keep at least one view with unique view names/IDs.')
  const presentations: Presentation[] = list(p.presentations, 20).map(v => {
    const item = object(v); noSpec(item.customSpec)
    const selected = views.find(v => v.id === item.analysisViewId)
    if (!selected) throw new Error('Unknown presentation analysis view.')
    const snapshot = item.analysisSnapshot ? view(item.analysisSnapshot) : selected
    if (snapshot.id !== selected.id) throw new Error('Presentation snapshot must match its analysis view.')
    const n = object(item.narrative)
    const overrides = object(item.graphOverrides)
    const fullChart = chart(overrides, true)
    if (!Number.isSafeInteger(item.revision) || Number(item.revision) < 1) throw new Error('Invalid presentation revision.')
    return { id: text(item.id), label: text(item.label), revision: Number(item.revision), analysisViewId: selected.id, analysisSnapshot: snapshot, customSpec: null,
      snapshotPins: snapshot.sourceIds.map(() => ({ sourceId: source.id, artifactId: source.artifactId, runId: source.runId, contentHash: source.contentHash })),
      theme: choice(item.theme, ['merge-gateway', 'plain-dark', 'plain-light']), canvas: choice(item.canvas, ['landscape', 'square', 'portrait']),
      narrative: { title: text(n.title, 500, true), kicker: text(n.kicker, 500, true), cue: text(n.cue, 500, true), note: text(n.note, 2000, true), source: text(n.source, 500, true) },
      graphOverrides: Object.fromEntries(Object.keys(overrides).filter(k => k in fullChart).map(k => [k, fullChart[k as keyof ChartState]])),
      motion: completionOptions(object(item.motion)), renderer: { version: 'heval-studio/0.2', evaluationSchemaVersion: 2, projectSchemaVersion: 1 }, createdAt: text(item.createdAt), updatedAt: text(item.updatedAt) }
  })
  if (new Set(presentations.map(v => v.id)).size !== presentations.length) throw new Error('Presentation IDs must be unique.')
  const mode = choice(input.mode, ['analysis', 'presentation'])
  const viewId = text(input.viewId)
  const presentationId = input.presentationId === null ? null : text(input.presentationId)
  if (!views.some(v => v.id === viewId) || (presentationId && !presentations.some(p => p.id === presentationId)) || (mode === 'presentation' && !presentationId)) throw new Error('Choose a saved view or presentation.')
  return { project: { ...base.project, label: text(p.label, 120), updatedAt: text(p.updatedAt), analysisViews: views, presentations }, viewId, presentationId, mode }
}

/** The hosted viewer and Studio use the same row projection, filters and chart recipe. */
export async function renderReportProject(data: ReportData, document: ReportProject) {
  const project = document.project
  const artifact = await reportArtifact(data, project.id)
  const artifacts = new Map([[artifact.id, artifact]])
  const presentation = document.mode === 'presentation' ? project.presentations.find(p => p.id === document.presentationId) : undefined
  const view = presentation ? presentationAnalysis(project, presentation) : project.analysisViews.find(v => v.id === document.viewId)
  if (!view) throw new Error('Saved view not found.')
  const state = presentation ? presentationChart(view.chart, presentation.graphOverrides, presentation.narrative.title) : view.chart
  const rows = projectRows(project, artifacts, view.sourceIds).filter(row => view.filters.every(filter => !filter.values.length || filter.values.includes(String(row[filter.field]))))
  const fields = projectFields(project, artifacts, view.sourceIds)
  return { rows, state, presentation, fields, filters: view.filters, label: presentation?.label ?? view.label, output: buildChart(rows, state, fields) }
}
