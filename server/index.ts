import { socialApi, exportsEnabled } from './social-api'
import { resolve, sep } from 'node:path'
import { runner } from './runner'
import { createAuthenticator } from './auth'
import { createApi } from './api'

type SocketData = { runId: string; userId: string }
const enabled = process.env.HEVAL_ENABLE_RUNNER === '1' && Boolean(process.env.WORKOS_CLIENT_ID && process.env.HEVAL_GATEWAY_API_KEY)
const api = createApi(runner, createAuthenticator(process.env.WORKOS_CLIENT_ID, process.env.WORKOS_API_HOSTNAME), enabled, exportsEnabled)
const dist = resolve(import.meta.dir, '../dist')

const server = Bun.serve<SocketData>({
  port: Number(process.env.PORT || 4173), hostname: process.env.HOST || '127.0.0.1',
  idleTimeout: 255,
  maxRequestBodySize: 8 * 1024 * 1024,
  async fetch(req, server) {
    const url = new URL(req.url)
    const social = await socialApi(req)
    if (social) return social
    if (url.pathname.startsWith('/api/')) return api(req, (runId, userId) => server.upgrade(req, {
      data: { runId, userId }, headers: { 'Sec-WebSocket-Protocol': 'heval' },
    }))
    if (!['GET', 'HEAD'].includes(req.method)) return new Response('Method not allowed', { status: 405 })
    const path = url.pathname === '/' || url.pathname === '/login' ? '/index.html'
      : url.pathname === '/studio' ? '/studio.html' : url.pathname
    let decoded: string
    try { decoded = decodeURIComponent(path) } catch { return new Response('Bad path', { status: 400 }) }
    const target = resolve(dist, `.${decoded}`)
    if (!target.startsWith(dist + sep)) return new Response('Not found', { status: 404 })
    const file = Bun.file(target)
    return await file.exists() ? new Response(file) : new Response('Not found', { status: 404 })
  },
  websocket: {
    open(ws) {
      const run = runner.runs.get(ws.data.runId)
      if (!run || run.ownerId !== ws.data.userId) { ws.close(1008, 'Unauthorized'); return }
      const set = runner.subscribers.get(run.id) || new Set()
      set.add(ws); runner.subscribers.set(run.id, set)
      run.chunks.forEach((chunk) => ws.send(JSON.stringify({ type: 'data', ...chunk })))
      ws.send(JSON.stringify({ type: ['running', 'grading'].includes(run.status) ? 'status' : 'exit', status: run.status }))
    },
    message() {},
    close(ws) { runner.subscribers.get(ws.data.runId)?.delete(ws) },
  },
})
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => {
  void runner.shutdown().finally(() => { server.stop(true); process.exit(0) })
})
console.log(`Heval Bun server listening on ${server.url}`)
