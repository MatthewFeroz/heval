/** Opt-in live deployment verification. Retains a private smoke report under a
 * synthetic identity, separate from all real users. Consumes rendering resources. */
import { ConvexHttpClient } from 'convex/browser'
import { get } from '@vercel/blob'
import { api } from '../convex/_generated/api'
import { newPresentation } from '../src/project/schema'
import { SOCIAL_DEFAULTS } from '../src/charts/social-presets'
import type { ReportProject } from '../src/reports/project'
import fixture from '../results/harbor/demo-evaluation.json'
const key = process.env.CONVEX_DEPLOY_KEY, url = process.env.CONVEX_URL
if (!key || !url) throw new Error('Provide deployment credentials and CONVEX_URL explicitly.')
const client = new ConvexHttpClient(url)
// Convex exposes admin identity impersonation for deployment-side testing.
// @ts-expect-error internal SDK API used only by this opt-in deployment script
client.setAdminAuth(key, { subject: 'heval-deployment-smoke', issuer: 'https://heval-deployment-smoke.invalid', tokenIdentifier: 'heval-deployment-smoke' })
const prior = (await client.query(api.reports.list, {})).find(r => r.title === 'Hosted export deployment smoke')
const report = prior?.id ?? await client.mutation(api.reports.save, { json: JSON.stringify(fixture), title: 'Hosted export deployment smoke' })
if (!(await client.query(api.presentationExports.available, {}))) throw new Error('Hosted export configuration is incomplete')
for (const collection of [false, true]) {
  const state = (await client.query(api.reports.get, { id: report }))!
  const document: ReportProject = JSON.parse(state.project)
  const p = document.project.presentations[0] ?? newPresentation(document.project, document.project.analysisViews[0])
  p.social = { ...SOCIAL_DEFAULTS, collection: ['completed', 'cost-per-success'] }
  document.project.presentations = [p]; document.presentationId = p.id; document.mode = 'presentation'
  const result = await client.mutation(api.presentationExports.request, { report, document: JSON.stringify(document), expectedVersion: state.version, collection, requestId: crypto.randomUUID() })
  console.log(`Queued ${collection ? 'ZIP' : 'PNG'} smoke export.`)
  const deadline = Date.now() + 300_000
  let finished = false
  while (Date.now() < deadline) {
    const job = (await client.query(api.presentationExports.list, { report })).find(j => j._id === result.job)!
    if (job.status === 'failed') throw new Error(job.error || 'Cloud export failed')
    if (job.status === 'complete') { finished = true; break }
    await new Promise(resolve => setTimeout(resolve, 3000))
  }
  if (!finished) throw new Error('Cloud export timed out')
  const artifact = await client.query(api.presentationExports.artifact, { job: result.job })
  const file = await get(artifact.pathname, { access: 'private', token: process.env.BLOB_READ_WRITE_TOKEN })
  if (!file || file.statusCode !== 200) throw new Error('Private artifact could not be read')
  const bytes = Buffer.from(await new Response(file.stream).arrayBuffer())
  if (collection ? bytes.readUInt32LE(0) !== 0x04034b50 : bytes.readUInt32BE(16) !== 3200) throw new Error('Invalid rendered artifact')
  console.log(`PASS: Convex queue → Sandbox → private Blob → saved history → ${collection ? 'ZIP' : 'PNG'} download.`)
}
