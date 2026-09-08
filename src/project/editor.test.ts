import { expect, test } from 'bun:test'
import { DEFAULT_STATE, buildChart } from '../charts/recipes'
import { editorReducer, saveDocument, viewDocument, type EditorHistory } from './editor'
import { adaptJobExportV1, contentHash, newProject, sourceFromArtifact } from './schema'
import { projectFields, projectRows, compatibleSources } from './accessors'
import { motionInput, parseMotionInput } from './motion-input'
import fixture from '../../results/harbor/terminal-bench-glm53-smoke.json'
import type { JobExport } from '../charts/trial'

test('undo and redo restore chart, filters, and custom spec together; a new edit clears redo', () => {
  const initial = { chart: DEFAULT_STATE, filters: [], sourceIds: ['one'], customSpec: null }
  let history: EditorHistory = { past: [], present: initial, future: [] }
  history = editorReducer(history, { type: 'change', update: (current) => ({ ...current, chart: { ...current.chart, measure: 'costUsd' }, customSpec: '{"mark":"bar"}' }) })
  const edited = history.present
  history = editorReducer(history, { type: 'undo' })
  expect(history.present).toEqual(initial)
  history = editorReducer(history, { type: 'redo' })
  expect(history.present).toEqual(edited)
  history = editorReducer(history, { type: 'undo' })
  history = editorReducer(history, { type: 'change', update: (current) => ({ ...current, sourceIds: ['two'] }) })
  expect(history.future).toEqual([])
  const saved = saveDocument({ id: 'v', label: 'View', createdAt: '', updatedAt: '', ...initial }, history.present)
  expect(viewDocument(saved)).toEqual(history.present)
})

test('artifact fields reach selectors and chart aggregation without canonical mappings', async () => {
  const artifact = await adaptJobExportV1(fixture as unknown as JobExport)
  artifact.fields.push({ id: 'accuracy', label: 'Accuracy', kind: 'metric', valueType: 'number', unit: 'ratio' }, { id: 'region', label: 'Region', kind: 'dimension', valueType: 'string' })
  for (const record of artifact.records) { record.values.accuracy = 0.75; record.values.region = 'West' }
  artifact.contentHash = await contentHash(artifact)
  const source = await sourceFromArtifact(artifact, 'source.json')
  const project = newProject(source, artifact)
  const artifacts = new Map([[artifact.id, artifact]])
  const fields = projectFields(project, artifacts, [source.id])
  const rows = projectRows(project, artifacts, [source.id])
  expect(fields.find((field) => field.key === 'custom:accuracy')?.label).toBe('Accuracy')
  expect(compatibleSources(project, artifacts, [source.id], 'custom:accuracy').sourceIds).toEqual([source.id])
  const chart = buildChart(rows, { measure: 'custom:accuracy', x: 'custom:region', color: 'none' }, fields)
  expect(chart.table[0].value).toBe(0.75)
  expect(chart.table[0]['custom:region']).toBe('West')
  expect(JSON.stringify(chart.spec)).toContain('Accuracy')
})

test('motion input carries filtered rows and validates exported data', () => {
  const selected = (fixture as unknown as JobExport).rows.slice(0, 1)
  expect(parseMotionInput(JSON.parse(JSON.stringify(motionInput('Imported selection', selected)))).rows).toEqual(selected)
  expect(() => parseMotionInput(motionInput('Empty', []))).toThrow()
  expect(() => parseMotionInput({ ...motionInput('Bad', selected), rows: [{ modelShort: 'x', passed: 3 }] })).toThrow()
})

test('custom scatter frontiers respect lower-is-better metrics', () => {
  const base = (fixture as unknown as JobExport).rows[0]
  const rows = [
    { ...base, agent: 'a', 'custom:latency': 10, 'custom:cost': 2 },
    { ...base, agent: 'b', 'custom:latency': 20, 'custom:cost': 3 },
  ]
  const chart = buildChart(rows, { recipe: 'scatter', x: 'agent', color: 'none', measure: 'custom:latency', xMeasure: 'custom:cost' }, [
    { key: 'custom:latency', label: 'Latency', kind: 'metric', direction: 'lower' },
    { key: 'custom:cost', label: 'Cost', kind: 'metric', direction: 'lower' },
  ])
  expect(chart.table.find((row) => row.agent === 'a')?.frontier).toBe(true)
  expect(chart.table.find((row) => row.agent === 'b')?.frontier).toBe(false)
})
