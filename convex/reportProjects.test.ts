import { newPresentation } from '../src/project/schema'
import { SOCIAL_DEFAULTS } from '../src/charts/social-presets'
/// <reference types="vite/client" />
import { convexTest } from 'convex-test'
import { expect, test } from 'vitest'
import schema from './schema'
import { api } from './_generated/api'
import fixture from '../results/harbor/terminal-bench-comparison.json'
import { renderReportProject, type ReportProject } from '../src/reports/project'

const modules = import.meta.glob(['./**/*.ts', './**/*.js', '!./**/*.test.ts'])
const token = 'c'.repeat(64), invite = 'd'.repeat(64)
async function setup() {
  const t = convexTest(schema, modules)
  const owner = t.withIdentity({ subject: 'owner' }), editor = t.withIdentity({ subject: 'editor' }), viewer = t.withIdentity({ subject: 'viewer' })
  const id = await owner.mutation(api.reports.save, { json: JSON.stringify(fixture), title: 'Team benchmark' })
  const report = (await owner.query(api.reports.get, { id }))!
  const document: ReportProject = JSON.parse(report.project)
  return { t, owner, editor, viewer, id, document, report }
}
test('saved charts and filters survive reload; drafts stay private until publication', async () => {
  const { t, owner, id, document, report } = await setup()
  await owner.mutation(api.reports.share, { id, token })
  document.project.analysisViews[0].chart.title = 'Reviewed chart'
  document.project.analysisViews[0].chart.recipe = 'strip'
  document.project.analysisViews[0].filters = [{ field: 'model', values: [fixture.rows[0].model] }]
  document.project.label = 'New draft title'
  await owner.mutation(api.reportProjects.saveDraft, { id, expectedVersion: 0, document: JSON.stringify(document) })
  const saved = (await owner.query(api.reports.get, { id }))!
  expect(saved.version).toBe(1)
  const rendered = await renderReportProject(JSON.parse(report.data), JSON.parse(saved.project))
  expect(rendered.state).toMatchObject({ recipe: 'strip', title: 'Reviewed chart' })
  expect(rendered.rows.every(r => r.model === fixture.rows[0].model)).toBe(true)
  expect(await t.query(api.reports.shared, { token })).toMatchObject({ title: 'Team benchmark', version: 0 })
  await owner.mutation(api.reportProjects.publish, { id, expectedVersion: 1 })
  expect(await t.query(api.reports.shared, { token })).toMatchObject({ title: 'New draft title', version: 1, project: saved.project })
  await owner.mutation(api.reports.revoke, { id })
  await owner.mutation(api.reportProjects.saveDraft, { id, expectedVersion: 1, document: JSON.stringify({ ...document, project: { ...document.project, label: 'Unpublished' } }) })
  await owner.mutation(api.reports.share, { id, token: 'e'.repeat(64) })
  expect(await t.query(api.reports.shared, { token: 'e'.repeat(64) })).toMatchObject({ version: 1, title: 'New draft title' })
  expect(await t.query(api.reports.shared, { token })).toBeNull()
})
test('first share publishes the saved draft; stale saves and publishes cannot overwrite it', async () => {
  const { t, owner, id, document } = await setup()
  document.project.analysisViews[0].chart.title = 'First saved draft'
  await owner.mutation(api.reportProjects.saveDraft, { id, expectedVersion: 0, document: JSON.stringify(document) })
  await expect(owner.mutation(api.reportProjects.saveDraft, { id, expectedVersion: 0, document: JSON.stringify(document) })).rejects.toThrow('newer version')
  await expect(owner.mutation(api.reportProjects.publish, { id, expectedVersion: 0 })).rejects.toThrow('draft changed')
  await owner.mutation(api.reports.share, { id, token })
  expect(await t.query(api.reports.shared, { token })).toMatchObject({ version: 1 })
})
test('editor and viewer invitations enforce report permissions and removal takes effect', async () => {
  const { t, owner, editor, viewer, id, document } = await setup()
  await owner.mutation(api.reportProjects.invite, { id, token: invite, role: 'editor' })
  await editor.mutation(api.reportProjects.accept, { token: invite })
  expect(await editor.query(api.reports.list)).toMatchObject([{ id, role: 'editor' }])
  await editor.mutation(api.reportProjects.saveDraft, { id, expectedVersion: 0, document: JSON.stringify(document) })
  await expect(editor.mutation(api.reportProjects.publish, { id, expectedVersion: 1 })).rejects.toThrow('permission')
  await expect(editor.mutation(api.reports.share, { id, token })).rejects.toThrow('not found')
  await expect(editor.mutation(api.reportProjects.invite, { id, token, role: 'viewer' })).rejects.toThrow('permission')
  await expect(viewer.mutation(api.reportProjects.accept, { token: invite })).rejects.toThrow('unavailable')
  await owner.mutation(api.reportProjects.invite, { id, token, role: 'viewer' })
  await viewer.mutation(api.reportProjects.accept, { token })
  expect(await viewer.query(api.reports.get, { id })).toMatchObject({ role: 'viewer', shareToken: null })
  await expect(viewer.mutation(api.reportProjects.saveDraft, { id, expectedVersion: 1, document: JSON.stringify(document) })).rejects.toThrow('permission')
  await expect(t.mutation(api.reportProjects.accept, { token })).rejects.toThrow('Sign in')
  const team = await owner.query(api.reportProjects.team, { id })
  await owner.mutation(api.reportProjects.removeMember, { member: team.members.find(m => m.role === 'editor')!.id })
  expect(await editor.query(api.reports.get, { id })).toBeNull()
  await expect(editor.mutation(api.reportProjects.accept, { token: invite })).rejects.toThrow('removed')
  await expect(editor.mutation(api.reportProjects.saveDraft, { id, expectedVersion: 1, document: JSON.stringify(document) })).rejects.toThrow('not found')
})
test('expired and revoked invitations cannot grant access', async () => {
  const { t, owner, editor, id } = await setup()
  const first = await owner.mutation(api.reportProjects.invite, { id, token, role: 'editor' })
  await owner.mutation(api.reportProjects.revokeInvite, { invite: first })
  await expect(editor.mutation(api.reportProjects.accept, { token })).rejects.toThrow('unavailable')
  const second = await owner.mutation(api.reportProjects.invite, { id, token: invite, role: 'editor' })
  await t.run(ctx => ctx.db.patch(second, { expiresAt: Date.now() - 1000 }))
  await expect(editor.mutation(api.reportProjects.accept, { token: invite })).rejects.toThrow('unavailable')
})
test('server rejects custom specs, changed evidence, and empty publication', async () => {
  const { owner, id, document } = await setup()
  const spec = structuredClone(document)
  spec.project.analysisViews[0].customSpec = '{"data":{"url":"https://example.com"}}'
  await expect(owner.mutation(api.reportProjects.saveDraft, { id, expectedVersion: 0, document: JSON.stringify(spec) })).rejects.toThrow('Custom Vega')
  const source = structuredClone(document); source.project.sources[0].label = 'Tampered'
  await expect(owner.mutation(api.reportProjects.saveDraft, { id, expectedVersion: 0, document: JSON.stringify(source) })).rejects.toThrow('source pins')
  document.project.analysisViews[0].filters = [{ field: 'model', values: ['nonexistent'] }]
  await owner.mutation(api.reportProjects.saveDraft, { id, expectedVersion: 0, document: JSON.stringify(document) })
  await expect(owner.mutation(api.reportProjects.publish, { id, expectedVersion: 1 })).rejects.toThrow('at least one trial')
  await expect(owner.mutation(api.reports.share, { id, token })).rejects.toThrow('at least one trial')
})
test('legacy shared reports keep their original appearance while drafts change', async () => {
  const { t, owner, id, document } = await setup()
  await t.run(ctx => ctx.db.patch(id, { shareToken: token }))
  document.project.analysisViews[0].chart.title = 'Unpublished legacy edit'
  await owner.mutation(api.reportProjects.saveDraft, { id, expectedVersion: 0, document: JSON.stringify(document) })
  const shared = (await t.query(api.reports.shared, { token }))!
  expect(JSON.parse(shared.project).project.analysisViews[0].chart.title).toBe('Completion by agent and model')
})

test('presentation questions and styles survive cloud save, reload and publication', async () => {
  const { owner, t, id, document } = await setup()
  const presentation = newPresentation(document.project, document.project.analysisViews[0])
  presentation.social = { ...SOCIAL_DEFAULTS, preset: 'cost-per-success', theme: 'merge-light', models: ['glm-5.3', 'claude-sonnet-5'], source: 'Saved source' }
  document.project.presentations = [presentation]
  document.presentationId = presentation.id
  document.mode = 'presentation'
  await owner.mutation(api.reportProjects.saveDraft, { id, expectedVersion: 0, document: JSON.stringify(document) })
  const saved = (await owner.query(api.reports.get, { id }))!
  expect(JSON.parse(saved.project).project.presentations[0].social).toEqual(presentation.social)
  await owner.mutation(api.reports.share, { id, token })
  const shared = (await t.query(api.reports.shared, { token }))!
  expect(JSON.parse(shared.project).project.presentations[0].social).toEqual(presentation.social)
  presentation.social = { ...presentation.social, preset: 'invalid' as never }
  await expect(owner.mutation(api.reportProjects.saveDraft, { id, expectedVersion: 1, document: JSON.stringify(document) })).rejects.toThrow()
})
