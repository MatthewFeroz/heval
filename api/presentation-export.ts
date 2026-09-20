import { ConvexHttpClient } from 'convex/browser'
import { get } from '@vercel/blob'
import { api } from '../convex/_generated/api.js'
import type { Id } from '../convex/_generated/dataModel.js'

export async function GET(request: Request) {
  const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' }
  const authorization = request.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ')) return new Response('Sign in to download.', { status: 401, headers })
  const url = process.env.CONVEX_URL || process.env.VITE_CONVEX_URL
  if (!url || !process.env.BLOB_READ_WRITE_TOKEN) return new Response('Export downloads are not configured.', { status: 503, headers })
  const job = new URL(request.url).searchParams.get('job')
  if (!job || job.length > 100) return new Response('Invalid export.', { status: 400, headers })
  const client = new ConvexHttpClient(url)
  client.setAuth(authorization.slice(7))
  let artifact
  try { artifact = await client.query(api.presentationExports.artifact, { job: job as Id<'presentationExports'> }) }
  catch { return new Response('Export unavailable.', { status: 404, headers }) }
  try {
    const file = await get(artifact.pathname, { access: 'private', token: process.env.BLOB_READ_WRITE_TOKEN })
    if (!file || file.statusCode !== 200) return new Response('Export unavailable.', { status: 404, headers })
    return new Response(file.stream, { headers: { ...headers, 'Content-Type': artifact.contentType, 'Content-Disposition': `attachment; filename="${artifact.filename}"`, 'X-Content-Type-Options': 'nosniff' } })
  } catch { return new Response('Download failed. Try again.', { status: 502, headers }) }
}
