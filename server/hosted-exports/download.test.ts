/// <reference types="vite/client" />
import { beforeEach, afterEach, expect, test, vi } from 'vitest'
import { convexTest } from 'convex-test'
import schema from '../../convex/schema'
import { api } from '../../convex/_generated/api'
import fixture from '../../tests/fixtures/report-sharing.json'
const mocks = vi.hoisted(() => ({ query: vi.fn(), setAuth: vi.fn(), get: vi.fn() }))
vi.mock('convex/browser', () => ({ ConvexHttpClient: class { query = mocks.query; setAuth = mocks.setAuth } }))
vi.mock('@vercel/blob', () => ({ get: mocks.get }))
import { GET } from '../../api/presentation-export'
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv('CONVEX_URL', 'https://test.convex.cloud'); vi.stubEnv('BLOB_READ_WRITE_TOKEN', 'private-token') })
afterEach(() => vi.unstubAllEnvs())
const request = () => new Request('https://heval.invalid/api/presentation-export?job=job', { headers: { Authorization: 'Bearer user-token' } })
test('download requires auth and current report access before contacting private storage', async () => {
  expect((await GET(new Request('https://heval.invalid/api/presentation-export?job=job'))).status).toBe(401)
  expect(mocks.query).not.toHaveBeenCalled()
  mocks.query.mockRejectedValue(new Error('No membership'))
  expect((await GET(request())).status).toBe(404)
  expect(mocks.get).not.toHaveBeenCalled()
  expect(mocks.setAuth).toHaveBeenCalledWith('user-token')
})
test('download streams authorized artifact without public caching or exposing its storage token', async () => {
  mocks.query.mockResolvedValue({ pathname: 'private/file.png', contentType: 'image/png', filename: 'file.png' })
  mocks.get.mockResolvedValue({ statusCode: 200, stream: new Blob(['png-bytes']).stream() })
  const response = await GET(request())
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(response.headers.get('content-disposition')).toBe('attachment; filename="file.png"')
  expect(await response.text()).toBe('png-bytes')
  expect(JSON.stringify([...response.headers])).not.toContain('private-token')
})

test.each(['viewer', 'editor'] as const)('download proxy rechecks %s membership after an earlier successful download', async role => {
  const modules = import.meta.glob(['../../convex/**/*.ts', '../../convex/**/*.js', '!../../convex/**/*.test.ts'])
  const t = convexTest(schema, modules), owner = t.withIdentity({ subject: 'synthetic-owner' }), member = t.withIdentity({ subject: `synthetic-${role}` })
  const report = await owner.mutation(api.reports.save, { title: 'SYNTHETIC download access check', json: JSON.stringify(fixture) })
  // A completed artifact is seeded locally; no renderer or storage service is contacted.
  const job = await t.run(ctx => ctx.db.insert('presentationExports', { report, owner: 'synthetic-owner', requestId: 'synthetic-download-job', version: 0, status: 'complete', collection: false, preset: 'completed', theme: 'plain-light', snapshotId: 'synthetic-snapshot', inputHash: 'synthetic-input', pathname: 'private/synthetic.png', filename: 'synthetic.png', contentType: 'image/png', bytes: 15 }))
  let client = member
  mocks.query.mockImplementation((ref, args) => client.query(ref, args))
  mocks.get.mockImplementation(() => ({ statusCode: 200, stream: new Blob(['synthetic-bytes']).stream() }))
  const download = () => GET(new Request(`https://heval.invalid/api/presentation-export?job=${job}`, { headers: { Authorization: 'Bearer synthetic-user-token' } }))
  const assertDenied = async () => {
    mocks.get.mockClear()
    const response = await download()
    expect(response.status).toBe(404)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(mocks.get).not.toHaveBeenCalled()
  }
  await assertDenied()
  const token = 'c'.repeat(64)
  await owner.mutation(api.reportProjects.invite, { id: report, token, role })
  await member.mutation(api.reportProjects.accept, { token })
  const authorized = await download()
  expect(authorized.status).toBe(200)
  expect(await authorized.text()).toBe('synthetic-bytes')
  const team = await owner.query(api.reportProjects.team, { id: report })
  await owner.mutation(api.reportProjects.removeMember, { member: team.members[0].id })
  await assertDenied()
  const shareToken = 'd'.repeat(64)
  await owner.mutation(api.reports.share, { id: report, token: shareToken })
  expect(await member.query(api.reports.shared, { token: shareToken })).not.toBeNull()
  await assertDenied()
  const anonymous = await GET(new Request(`https://heval.invalid/api/presentation-export?job=${job}#${shareToken}`))
  expect(anonymous.status).toBe(401)
  expect(mocks.get).not.toHaveBeenCalled()
  await owner.mutation(api.reports.revoke, { id: report })
  client = owner
  expect((await download()).status).toBe(200)
})
