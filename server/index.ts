import { cancelRun, gradeRun, isHarness, runs, startRun, subscribers } from './runner'
import { createRemoteJWKSet, jwtVerify } from 'jose'

type SocketData = { runId: string }
const port = Number(process.env.PORT || 4173)
const enabled = process.env.HEVAL_ENABLE_RUNNER === '1'
const workosClientId = process.env.WORKOS_CLIENT_ID
const workosApiHostname = process.env.WORKOS_API_HOSTNAME || 'api.workos.com'
const workosIssuer = `https://${workosApiHostname}`
const workosJwks = workosClientId
  ? createRemoteJWKSet(new URL(`${workosIssuer}/sso/jwks/${workosClientId}`))
  : null
const dist = `${import.meta.dir}/../dist`

async function authorized(req: Request) {
  if (!enabled || !workosClientId || !workosJwks) return false
  const socketToken = req.headers.get('sec-websocket-protocol')
    ?.split(',')
    .map((protocol) => protocol.trim())
    .find((protocol) => protocol.startsWith('heval-auth.'))
    ?.slice('heval-auth.'.length)
  const token = req.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1] || socketToken
  if (!token) return false
  try {
    const { payload } = await jwtVerify(token, workosJwks, { issuer: [workosIssuer, `${workosIssuer}/`] })
    return payload.client_id === workosClientId
  } catch {
    return false
  }
}

const server = Bun.serve<SocketData>({
  port,
  hostname: '0.0.0.0',
  async fetch(req, server) {
    const url = new URL(req.url)
    if (url.pathname === '/api/health') return Response.json({ ok: true, runnerEnabled: enabled && Boolean(workosClientId) })
    if (url.pathname === '/api/runs' && req.method === 'GET') return Response.json([...runs.values()].map((run) => ({ id: run.id, harness: run.harness, status: run.status, startedAt: run.startedAt, exitCode: run.exitCode, chunks: run.chunks })))
    if (url.pathname === '/api/runs' && req.method === 'POST') {
      if (!await authorized(req)) return Response.json({ error: 'Sign in to run evaluations' }, { status: 401 })
      const body = await req.json().catch(() => ({})) as { harness?: unknown }
      if (!isHarness(body.harness)) return Response.json({ error: 'Unknown harness' }, { status: 400 })
      const run = startRun(body.harness)
      return Response.json({ id: run.id, harness: run.harness, status: run.status })
    }
    const gradeMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/grade$/)
    if (gradeMatch && req.method === 'POST') {
      if (!await authorized(req)) return Response.json({ error: 'Unauthorized' }, { status: 401 })
      const run = runs.get(gradeMatch[1])
      if (!run) return Response.json({ error: 'Not found' }, { status: 404 })
      return Response.json(await gradeRun(run))
    }
    const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/)
    if (runMatch) {
      if (!await authorized(req)) return Response.json({ error: 'Unauthorized' }, { status: 401 })
      const run = runs.get(runMatch[1])
      if (req.method === 'DELETE') {
        if (!run) return Response.json({ error: 'Not found' }, { status: 404 })
        return Response.json({ cancelled: cancelRun(run) })
      }
      return run ? Response.json({ ...run, terminal: undefined }) : Response.json({ error: 'Not found' }, { status: 404 })
    }
    const socketMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/stream$/)
    if (socketMatch) {
      if (!await authorized(req)) return new Response('Unauthorized', { status: 401 })
      if (!runs.has(socketMatch[1])) return new Response('Not found', { status: 404 })
      return server.upgrade(req, { data: { runId: socketMatch[1] }, headers: { 'Sec-WebSocket-Protocol': 'heval' } }) ? undefined : new Response('Upgrade failed', { status: 400 })
    }
    // Pretty URLs for the two pages; everything else is a dist asset. The
    // studio's job exports are copied into dist/results by the Vite build.
    const path = url.pathname === '/' ? '/index.html'
      : url.pathname === '/studio' ? '/studio.html'
      : url.pathname
    const file = Bun.file(`${dist}${path}`)
    if (await file.exists()) return new Response(file)
    return new Response(Bun.file(`${dist}/index.html`))
  },
  websocket: {
    open(ws) {
      const set = subscribers.get(ws.data.runId) || new Set()
      set.add(ws)
      subscribers.set(ws.data.runId, set)
      const run = runs.get(ws.data.runId)
      run?.chunks.forEach((chunk) => ws.send(JSON.stringify({ type: 'data', ...chunk })))
    },
    message() {},
    close(ws) { subscribers.get(ws.data.runId)?.delete(ws) },
  },
})

console.log(`Heval Bun server listening on ${server.url}`)
