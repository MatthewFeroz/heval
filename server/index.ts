import { cancelRun, isHarness, runs, startRun, subscribers } from './runner'

type SocketData = { runId: string }
const port = Number(process.env.PORT || 4173)
const enabled = process.env.HEVAL_ENABLE_RUNNER === '1'
const token = process.env.HEVAL_RUNNER_TOKEN
const dist = `${import.meta.dir}/../dist`

function authorized(req: Request) {
  return enabled && Boolean(token) && req.headers.get('authorization') === `Bearer ${token}`
}

const server = Bun.serve<SocketData>({
  port,
  hostname: '0.0.0.0',
  async fetch(req, server) {
    const url = new URL(req.url)
    if (url.pathname === '/api/health') return Response.json({ ok: true, runnerEnabled: enabled && Boolean(token) })
    if (url.pathname === '/api/runs' && req.method === 'GET') return Response.json([...runs.values()].map((run) => ({ id: run.id, harness: run.harness, status: run.status, startedAt: run.startedAt, exitCode: run.exitCode, chunks: run.chunks })))
    if (url.pathname === '/api/runs' && req.method === 'POST') {
      if (!authorized(req)) return Response.json({ error: 'Runner disabled or unauthorized' }, { status: 403 })
      const body = await req.json().catch(() => ({})) as { harness?: unknown }
      if (!isHarness(body.harness)) return Response.json({ error: 'Unknown harness' }, { status: 400 })
      const run = startRun(body.harness)
      return Response.json({ id: run.id, harness: run.harness, status: run.status })
    }
    const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/)
    if (runMatch) {
      if (!authorized(req)) return Response.json({ error: 'Unauthorized' }, { status: 403 })
      const run = runs.get(runMatch[1])
      if (req.method === 'DELETE') {
        if (!run) return Response.json({ error: 'Not found' }, { status: 404 })
        return Response.json({ cancelled: cancelRun(run) })
      }
      return run ? Response.json({ ...run, terminal: undefined }) : Response.json({ error: 'Not found' }, { status: 404 })
    }
    const socketMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/stream$/)
    if (socketMatch) {
      if (!enabled || !token || url.searchParams.get('token') !== token) return new Response('Unauthorized', { status: 403 })
      if (!runs.has(socketMatch[1])) return new Response('Not found', { status: 404 })
      return server.upgrade(req, { data: { runId: socketMatch[1] } }) ? undefined : new Response('Upgrade failed', { status: 400 })
    }
    const path = url.pathname === '/' ? '/index.html' : url.pathname
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
