/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import schema from './schema'
import { api, internal } from './_generated/api'
import fixture from '../results/harbor/demo-evaluation.json'
import { newPresentation } from '../src/project/schema'
import { SOCIAL_DEFAULTS } from '../src/charts/social-presets'
import type { ReportProject } from '../src/reports/project'
const modules = import.meta.glob(['./**/*.ts', './**/*.js', '!./**/*.test.ts'])
beforeEach(() => {
  vi.useFakeTimers()
  for (const key of ['HEVAL_EXPORT_SNAPSHOT_ID', 'VERCEL_TOKEN', 'VERCEL_PROJECT_ID', 'VERCEL_TEAM_ID', 'BLOB_READ_WRITE_TOKEN']) vi.stubEnv(key, 'test-only')
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })
async function setup() {
  const t = convexTest(schema, modules), owner = t.withIdentity({ subject: 'owner' })
  const report = await owner.mutation(api.reports.save, { json: JSON.stringify(fixture), title: 'Presentation' })
  const saved = (await owner.query(api.reports.get, { id: report }))!
  const document: ReportProject = JSON.parse(saved.project)
  const p = newPresentation(document.project, document.project.analysisViews[0])
  p.social = { ...SOCIAL_DEFAULTS, preset: 'cost-per-success', theme: 'plain-light', models: ['model-a', 'model-c'] }
  document.project.presentations = [p]; document.presentationId = p.id; document.mode = 'presentation'
  const args = { report, expectedVersion: 0, document: JSON.stringify(document), collection: false, requestId: 'request-0000000001' }
  return { t, owner, report, document, args }
}
test('enqueue atomically saves settings; immutable inputs and history survive later edits; requests are idempotent', async () => {
  const { t, owner, report, document, args } = await setup()
  const result = await owner.mutation(api.presentationExports.request, args)
  expect(await owner.mutation(api.presentationExports.request, args)).toEqual(result)
  expect(await owner.query(api.presentationExports.list, { report })).toHaveLength(1)
  const saved = (await owner.query(api.reports.get, { id: report }))!
  expect(saved.version).toBe(1)
  expect(JSON.parse(saved.project).project.presentations[0].social).toMatchObject({ preset: 'cost-per-success', theme: 'plain-light', models: ['model-a', 'model-c'] })
  document.project.presentations[0].social!.preset = 'completed'
  await owner.mutation(api.reportProjects.saveDraft, { id: report, expectedVersion: 1, document: JSON.stringify(document) })
  await t.mutation(internal.presentationExports.pump, {})
  const input = (await t.query(internal.presentationExports.input, { job: result.job }))!
  expect(JSON.parse(input.payload).settings.preset).toBe('cost-per-success')
  expect(input.inputHash).toMatch(/^[a-f0-9]{64}$/)
  await t.mutation(internal.presentationExports.finish, { job: result.job, artifact: { pathname: 'private/file.png', filename: 'file.png', contentType: 'image/png', bytes: 42 } })
  expect(await owner.query(api.presentationExports.artifact, { job: result.job })).toMatchObject({ pathname: 'private/file.png' })
  expect((await owner.query(api.presentationExports.list, { report }))[0]).toMatchObject({ status: 'complete', version: 1 })
})
test('permissions apply to queue, history and downloads, including revoked membership', async () => {
  const { t, owner, report, args } = await setup()
  const stranger = t.withIdentity({ subject: 'stranger' })
  await expect(stranger.mutation(api.presentationExports.request, args)).rejects.toThrow('not found')
  await expect(stranger.query(api.presentationExports.list, { report })).rejects.toThrow('not found')
  await expect(t.query(api.presentationExports.list, { report })).rejects.toThrow('Sign in')
  const result = await owner.mutation(api.presentationExports.request, args)
  await expect(owner.query(api.presentationExports.artifact, { job: result.job })).rejects.toThrow('not ready')
  await t.mutation(internal.presentationExports.pump, {})
  await t.mutation(internal.presentationExports.finish, { job: result.job, artifact: { pathname: 'private/file.png', filename: 'file.png', contentType: 'image/png', bytes: 42 } })
  await expect(stranger.query(api.presentationExports.artifact, { job: result.job })).rejects.toThrow('not found')
  const token = 'a'.repeat(64)
  await owner.mutation(api.reportProjects.invite, { id: report, token, role: 'viewer' })
  await stranger.mutation(api.reportProjects.accept, { token })
  await expect(stranger.mutation(api.presentationExports.request, { ...args, expectedVersion: 1 })).rejects.toThrow('permission')
  expect(await stranger.query(api.presentationExports.artifact, { job: result.job })).toMatchObject({ filename: 'file.png' })
  const team = await owner.query(api.reportProjects.team, { id: report })
  await owner.mutation(api.reportProjects.removeMember, { member: team.members[0].id })
  await expect(stranger.query(api.presentationExports.artifact, { job: result.job })).rejects.toThrow('not found')
})
test('queue has one renderer; watchdog frees crashed jobs and ignores late completion', async () => {
  const { t, owner, args } = await setup()
  const first = await owner.mutation(api.presentationExports.request, args)
  const second = await owner.mutation(api.presentationExports.request, { ...args, expectedVersion: 1, requestId: 'request-0000000002' })
  await t.mutation(internal.presentationExports.pump, {})
  await t.mutation(internal.presentationExports.pump, {})
  expect(await t.query(internal.presentationExports.input, { job: first.job })).not.toBeNull()
  expect(await t.query(internal.presentationExports.input, { job: second.job })).toBeNull()
  await t.mutation(internal.presentationExports.expire, { job: first.job })
  expect(await t.mutation(internal.presentationExports.finish, { job: first.job, artifact: { pathname: 'late.png', filename: 'late.png', contentType: 'image/png', bytes: 1 } })).toBe(false)
  await t.mutation(internal.presentationExports.pump, {})
  expect(await t.query(internal.presentationExports.input, { job: second.job })).not.toBeNull()
})
test('stale drafts and unavailable configuration cannot enqueue or change saved settings', async () => {
  const { owner, report, args } = await setup()
  await expect(owner.mutation(api.presentationExports.request, { ...args, expectedVersion: 9 })).rejects.toThrow('newer version')
  vi.stubEnv('HEVAL_EXPORT_SNAPSHOT_ID', '')
  expect(await owner.query(api.presentationExports.available, {})).toBe(false)
  await expect(owner.mutation(api.presentationExports.request, args)).rejects.toThrow('not been configured')
  expect((await owner.query(api.reports.get, { id: report }))!.version).toBe(0)
})
test('catalog project import preserves questions, graph settings and snapshot filters', async () => {
  const { owner, document } = await setup()
  document.project.analysisViews[0].chart.recipe = 'strip'
  document.project.presentations[0].analysisSnapshot!.filters = [{ field: 'model', values: [fixture.rows[0].model] }]
  const report = await owner.mutation(api.reports.saveProject, { json: JSON.stringify(fixture), document: JSON.stringify(document) })
  const saved = (await owner.query(api.reports.get, { id: report }))!
  const restored: ReportProject = JSON.parse(saved.project)
  expect(restored.project.id).toBe(report)
  expect(restored.project.analysisViews[0].chart.recipe).toBe('strip')
  expect(restored.project.presentations[0].social?.preset).toBe('cost-per-success')
  expect(restored.project.presentations[0].analysisSnapshot?.filters[0].values).toEqual([fixture.rows[0].model])
  expect(restored.project.analysisViews[0].sourceIds).toEqual([restored.project.sources[0].id])
})
test('daily limits reject extra cloud work without saving another draft', async () => {
  const { owner, args, report } = await setup()
  for (let i = 0; i < 20; i++) await owner.mutation(api.presentationExports.request, { ...args, expectedVersion: i, requestId: `limited-request-${String(i).padStart(4, '0')}` })
  await expect(owner.mutation(api.presentationExports.request, { ...args, expectedVersion: 20, requestId: 'limited-request-extra' })).rejects.toThrow('daily limit')
  expect((await owner.query(api.reports.get, { id: report }))!.version).toBe(20)
  expect(await owner.query(api.presentationExports.list, { report })).toHaveLength(20)
})

test('new presentations are neutral and explicit white and black choices persist into exports', async () => {
  const { t, owner, report, document, args } = await setup()
  const fresh = newPresentation(document.project, document.project.analysisViews[0])
  expect(fresh).toMatchObject({ theme: 'plain-light', graphOverrides: { theme: 'light' }, social: { theme: 'plain-light', source: 'Evaluation results' }, motion: { theme: 'plain-light' } })
  let version = 0
  for (const theme of ['plain-dark', 'plain-light'] as const) {
    document.project.presentations[0].social!.theme = theme
    const result = await owner.mutation(api.presentationExports.request, { ...args, expectedVersion: version++, document: JSON.stringify(document), requestId: 'persist-theme-' + theme })
    const saved = (await owner.query(api.reports.get, { id: report }))!
    expect(JSON.parse(saved.project).project.presentations[0].social.theme).toBe(theme)
    await t.mutation(internal.presentationExports.pump, {})
    const input = (await t.query(internal.presentationExports.input, { job: result.job }))!
    expect(JSON.parse(input.payload).settings.theme).toBe(theme)
    await t.mutation(internal.presentationExports.finish, { job: result.job, error: 'Test finishes without cloud calls' })
  }
  // A legacy project without social settings gets an explicit neutral value on save.
  delete document.project.presentations[0].social
  await owner.mutation(api.reportProjects.saveDraft, { id: report, expectedVersion: version, document: JSON.stringify(document) })
  expect(JSON.parse((await owner.query(api.reports.get, { id: report }))!.project).project.presentations[0].social.theme).toBe('plain-light')
})
