import { beforeEach, afterEach, expect, test, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ create: vi.fn(), put: vi.fn() }))
vi.mock('@vercel/sandbox', () => ({ Sandbox: { create: mocks.create } }))
vi.mock('@vercel/blob', () => ({ put: mocks.put }))
import { renderHostedExport } from './render'
beforeEach(() => {
  vi.resetAllMocks()
  for (const key of ['VERCEL_TOKEN', 'VERCEL_PROJECT_ID', 'VERCEL_TEAM_ID', 'BLOB_READ_WRITE_TOKEN']) vi.stubEnv(key, 'test-secret')
})
afterEach(() => vi.unstubAllEnvs())
function sandbox() {
  const sandbox = { writeFiles: vi.fn(), runCommand: vi.fn().mockResolvedValue({ exitCode: 0 }), readFileToBuffer: vi.fn()
    .mockResolvedValueOnce(Buffer.from(JSON.stringify({ filename: 'completed.png', type: 'image/png', size: 3 }))).mockResolvedValueOnce(Buffer.from('png')), stop: vi.fn().mockResolvedValue(undefined) }
  mocks.create.mockResolvedValue(sandbox)
  mocks.put.mockResolvedValue({ pathname: 'presentation-exports/job/completed.png' })
  return sandbox
}
test('renders from pinned snapshot, uploads privately and stops; secrets never enter the sandbox', async () => {
  const sbx = sandbox()
  const artifact = await renderHostedExport({ job: 'job', snapshotId: 'snapshot', payload: '{"input":"data"}' })
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ source: { type: 'snapshot', snapshotId: 'snapshot' }, persistent: false, timeout: 240000, networkPolicy: 'deny-all' }))
  expect(JSON.stringify(sbx.writeFiles.mock.calls)).not.toContain('test-secret')
  expect(JSON.stringify(sbx.runCommand.mock.calls)).not.toContain('test-secret')
  expect(mocks.put).toHaveBeenCalledWith('presentation-exports/job/completed.png', Buffer.from('png'), expect.objectContaining({ access: 'private', addRandomSuffix: false }))
  expect(artifact.bytes).toBe(3)
  expect(sbx.stop).toHaveBeenCalledOnce()
})
test('renderer failures and storage failures always stop the sandbox', async () => {
  const sbx = sandbox()
  sbx.runCommand.mockResolvedValue({ exitCode: 1 })
  await expect(renderHostedExport({ job: 'job', snapshotId: 'snapshot', payload: '{}' })).rejects.toThrow('Renderer failed')
  expect(mocks.put).not.toHaveBeenCalled()
  expect(sbx.stop).toHaveBeenCalledOnce()
  const next = sandbox()
  mocks.put.mockRejectedValue(new Error('Storage unavailable'))
  await expect(renderHostedExport({ job: 'job', snapshotId: 'snapshot', payload: '{}' })).rejects.toThrow('Storage unavailable')
  expect(next.stop).toHaveBeenCalledOnce()
})
test('oversized or unexpected output cannot be uploaded', async () => {
  const sbx = sandbox()
  sbx.readFileToBuffer.mockReset().mockResolvedValue(Buffer.from(JSON.stringify({ filename: '../secret.png', type: 'image/png', size: 21_000_000 })))
  await expect(renderHostedExport({ job: 'job', snapshotId: 'snapshot', payload: '{}' })).rejects.toThrow('Invalid export metadata')
  expect(mocks.put).not.toHaveBeenCalled()
  expect(sbx.stop).toHaveBeenCalledOnce()
})
