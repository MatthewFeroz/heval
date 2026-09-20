import { Sandbox } from '@vercel/sandbox'
import { put } from '@vercel/blob'

export function sandboxCredentials() {
  const token = process.env.VERCEL_TOKEN, projectId = process.env.VERCEL_PROJECT_ID, teamId = process.env.VERCEL_TEAM_ID
  if (!token || !projectId || !teamId) throw new Error('Configure VERCEL_TOKEN, VERCEL_PROJECT_ID and VERCEL_TEAM_ID.')
  return { token, projectId, teamId }
}
export async function renderHostedExport(input: { job: string; payload: string; snapshotId: string }) {
  const sandbox = await Sandbox.create({ ...sandboxCredentials(), source: { type: 'snapshot', snapshotId: input.snapshotId }, persistent: false,
    timeout: 4 * 60_000, resources: { vcpus: 2 }, networkPolicy: 'deny-all' })
  try {
    await sandbox.writeFiles([{ path: '/vercel/sandbox/heval/input.json', content: Buffer.from(input.payload) }])
    const result = await sandbox.runCommand({ cmd: 'node', args: ['/vercel/sandbox/heval/renderer.mjs'], env: { HEVAL_RENDER_ROOT: '/vercel/sandbox/heval' } })
    if (result.exitCode !== 0) throw new Error('Renderer failed')
    const metadata = await sandbox.readFileToBuffer({ path: '/vercel/sandbox/heval/output.json' })
    if (!metadata) throw new Error('Missing export metadata')
    const { filename, type, size } = JSON.parse(metadata.toString())
    if (!/^[a-z0-9-]+\.(png|zip)$/.test(filename) || !['image/png', 'application/zip'].includes(type) || !Number.isSafeInteger(size) || size > 20_000_000) throw new Error('Invalid export metadata')
    const bytes = await sandbox.readFileToBuffer({ path: '/vercel/sandbox/heval/output.bin' })
    if (!bytes || bytes.length !== size) throw new Error('Missing export bytes')
    const blob = await put(`presentation-exports/${input.job}/${filename}`, bytes, {
      access: 'private', token: process.env.BLOB_READ_WRITE_TOKEN, contentType: type, addRandomSuffix: false, allowOverwrite: true,
    })
    return { pathname: blob.pathname, filename: filename as string, contentType: type as string, bytes: bytes.length }
  } finally { await sandbox.stop().catch(() => {}) }
}
