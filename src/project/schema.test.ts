import { SOCIAL_DEFAULTS } from '../charts/social-presets'
import { describe, expect, test } from 'bun:test'
import { compatibleSources, projectRows } from './accessors'
import {
  adaptJobExportV1,
  contentHash,
  makeBundle,
  newPresentation,
  newProject,
  parseBundle,
  parseProject,
  sourceFromArtifact,
  verifyContentHash,
  type EvaluationArtifact,
} from './schema'
import type { JobExport, TrialRow } from '../charts/trial'

const row: TrialRow = {
  trial: 'task__abc', task: 'task', taskFull: 'suite/task', taskChecksum: 'checksum',
  agent: 'codex', agentVersion: '1.0.0', model: 'provider/model', modelShort: 'model',
  provider: 'provider', vendor: 'vendor', stack: 'codex / model', reward: 1, passed: 1,
  agentSeconds: 10, totalSeconds: 12, overSlow: 0, timedOut: 0,
  inputTokens: 100, cacheTokens: 20, outputTokens: 10, totalTokens: 110,
  costUsd: 0.01, costSource: 'reported', startedAt: '2026-09-04T10:00:00Z', error: null,
}

const legacy: JobExport = {
  schemaVersion: 1,
  job: 'sample-job',
  jobId: 'run-1',
  generatedAt: '2026-09-04T11:00:00Z',
  source: '/tmp/sample-job',
  agentVersions: { codex: ['1.0.0'] },
  rows: [row],
}

describe('evaluation artifact adapter', () => {
  test('adapts JobExport v1 without changing it and maps records generically', async () => {
    const before = JSON.stringify(legacy)
    const artifact = await adaptJobExportV1(legacy, '/results/sample-job.json')
    const source = await sourceFromArtifact(artifact, '/results/sample-job.json')
    const project = newProject(source, artifact)
    const rows = projectRows(project, new Map([[artifact.id, artifact]]), [source.id])

    expect(JSON.stringify(legacy)).toBe(before)
    expect(artifact.schemaVersion).toBe(2)
    expect(artifact.run.id).toBe('run-1')
    expect(artifact.id).toContain('@2026-09-04T11:00:00Z')
    expect(await verifyContentHash(artifact)).toBe(true)
    expect(rows[0]).toMatchObject({ task: 'task', modelShort: 'model', passed: 1, source: 'sample-job', run: 'sample-job' })
  })

  test('detects a changed snapshot', async () => {
    const artifact = await adaptJobExportV1(legacy)
    artifact.records[0].values.reward = 0
    expect(await verifyContentHash(artifact)).toBe(false)
  })

  test('requires explicit semantic compatibility across sources', async () => {
    const first = await adaptJobExportV1(legacy)
    const second = structuredClone(first) as EvaluationArtifact
    second.id = 'second'
    second.label = 'seconds-as-milliseconds'
    second.fields.find((field) => field.id === 'agentSeconds')!.unit = 'milliseconds'
    second.contentHash = await contentHash(second)
    const one = await sourceFromArtifact(first, 'one.json')
    const two = await sourceFromArtifact(second, 'two.json')
    const project = newProject(one, first)
    project.sources.push(two)
    const result = compatibleSources(project, new Map([[first.id, first], [second.id, second]]), [one.id, two.id], 'agentSeconds')
    expect(result.sourceIds).toEqual([one.id])
    expect(result.incompatible).toEqual(['seconds-as-milliseconds'])
  })
})

describe('project and bundle files', () => {
  test('round-trips referenced projects and self-contained bundles with pins', async () => {
    const artifact = await adaptJobExportV1(legacy, '/results/sample-job.json')
    const source = await sourceFromArtifact(artifact, '/results/sample-job.json')
    const project = newProject(source, artifact)
    const presentation = newPresentation(project, project.analysisViews[0])
    project.presentations.push(presentation)
    const bundle = await makeBundle(project, [artifact])

    expect(parseProject(JSON.parse(JSON.stringify(project)))).toEqual(project)
    expect(parseBundle(JSON.parse(JSON.stringify(bundle)))).toEqual(bundle)
    expect(await verifyContentHash(bundle)).toBe(true)
    expect(presentation.snapshotPins).toEqual([{ sourceId: source.id, artifactId: artifact.id, runId: 'run-1', contentHash: artifact.contentHash }])
    expect(presentation.renderer.evaluationSchemaVersion).toBe(2)
  })

  test('rejects files with the wrong schema identity', () => {
    expect(() => parseProject({ schemaVersion: 1, sources: [] })).toThrow('Expected a .heval-project.json')
    expect(() => parseBundle({ artifactType: 'heval-bundle', schemaVersion: 2 })).toThrow('Expected a .heval-bundle.json')
  })
})

test('presentation snapshots and custom specs survive bundle round trips', async () => {
  const artifact = await adaptJobExportV1(legacy)
  const source = await sourceFromArtifact(artifact, 'source.json')
  const project = newProject(source, artifact)
  project.analysisViews[0].customSpec = '{"mark":"point","data":{"values":[]}}'
  project.analysisViews[0].filters = [{ field: 'agent', values: ['codex'] }]
  const presentation = newPresentation(project, project.analysisViews[0])
  project.presentations.push(presentation)
  project.analysisViews[0].chart.measure = 'costUsd'
  project.analysisViews[0].filters[0].values.push('pi')
  project.analysisViews[0].customSpec = null
  const restored = parseBundle(JSON.parse(JSON.stringify(await makeBundle(project, [artifact]))))
  expect(restored.project.presentations[0].analysisSnapshot?.chart.measure).toBe('passed')
  expect(restored.project.presentations[0].analysisSnapshot?.filters[0].values).toEqual(['codex'])
  expect(restored.project.presentations[0].customSpec).toContain('point')
  expect(await verifyContentHash(restored)).toBe(true)
})

test('rejects malformed persisted custom specs', async () => {
  const artifact = await adaptJobExportV1(legacy)
  const project = newProject(await sourceFromArtifact(artifact, 'source.json'), artifact)
  project.analysisViews[0].customSpec = '['
  expect(() => parseProject(project)).toThrow('valid JSON')
})

test('social settings survive project bundles without altering legacy motion', async () => {
  const artifact = await adaptJobExportV1(legacy)
  const project = newProject(await sourceFromArtifact(artifact, 'source.json'), artifact)
  const presentation = newPresentation(project, project.analysisViews[0])
  presentation.social = { ...SOCIAL_DEFAULTS, preset: 'slow-timeouts', source: 'Example evaluation', showSubtitle: false }
  project.presentations.push(presentation)
  const restored = parseBundle(JSON.parse(JSON.stringify(await makeBundle(project, [artifact]))))
  expect(restored.project.presentations[0].social).toEqual(presentation.social)
  expect(restored.project.presentations[0].motion).toEqual(presentation.motion)
  expect(await verifyContentHash(restored)).toBe(true)
  const bad = JSON.parse(JSON.stringify(project)); bad.presentations[0].social.preset = 'invalid'
  expect(() => parseProject(bad)).toThrow('Unknown social preset')
})
