import { socialApi, exportsEnabled } from './social-api'
import { resolve, sep } from 'node:path'
import { createConfiguredRunner } from './runtime'
import { createAuthenticator } from './auth'
import { createApi } from './api'
import { createSignupStore } from './signup'
import { deploymentPolicy } from './deployment'
import { connectionEncryptionKey, createConnectionStore } from './connections'
import { createInferenceProxy } from './inference-proxy'

const policy = deploymentPolicy(process.env)
const runner = createConfiguredRunner()
const authenticate = createAuthenticator(process.env.WORKOS_CLIENT_ID, process.env.WORKOS_API_HOSTNAME)
const signup = createSignupStore(process.env.HEVAL_DATA_DIR || resolve(import.meta.dir, '../data'))
const dataDirectory = process.env.HEVAL_DATA_DIR || resolve(import.meta.dir, '../data')
const connections = createConnectionStore(dataDirectory, connectionEncryptionKey(dataDirectory, process.env.HEVAL_CONNECTION_ENCRYPTION_KEY, policy.hosted))
const inference = createInferenceProxy(connections, policy.hosted ? `${policy.origin}/api/inference` : process.env.HEVAL_INFERENCE_PROXY_URL || `http://host.docker.internal:${process.env.PORT || 4173}/api/inference`)
if (policy.hosted && !await Bun.file(resolve(import.meta.dir, '../dist/public-build.json')).exists()) throw new Error('Hosted mode requires bun run build:public to exclude internal results')
await runner.ready

type SocketData = { runId: string; userId: string }
const enabled = process.env.HEVAL_ENABLE_RUNNER === '1' && Boolean(process.env.WORKOS_CLIENT_ID)
const api = createApi(runner, authenticate, enabled, exportsEnabled, policy.allowedUsers, { store: connections, proxy: inference })
const dist = resolve(import.meta.dir, '../dist')

const server = Bun.serve<SocketData>({
  port: Number(process.env.PORT || 4173), hostname: process.env.HOST || '127.0.0.1',
  idleTimeout: 255,
  maxRequestBodySize: 8 * 1024 * 1024,
  async fetch(req, server) {
    const url = new URL(req.url)
    const requestOrigin = req.headers.get('origin')
    if (url.pathname.startsWith('/api/') && requestOrigin && requestOrigin !== (policy.origin || url.origin)) return new Response('Origin not allowed', { status: 403 })
    if (url.pathname.startsWith('/api/inference/')) return inference.handle(req)
    if (url.pathname === '/api/signups') {
      const client = policy.hosted ? req.headers.get('x-real-ip') || 'unknown' : server.requestIP(req)?.address || 'unknown'
      try { return await signup.handle(req, client) } catch { return Response.json({ error: 'Could not save your signup. Please retry.' }, { status: 503 }) }
    }
    if (policy.hosted && /^\/api\/(posters|social)\//.test(url.pathname)) {
      const identity = await authenticate(req)
      if (!identity) return Response.json({ error: 'Sign in to preview and export images.' }, { status: 401 })
      if (!policy.allowedUsers?.has(identity.userId)) return Response.json({ error: 'Export access is by invitation.' }, { status: 403 })
    }
    if (policy.hosted && url.pathname.startsWith('/results/harbor/social/')) return new Response('Not found', { status: 404 })
    const social = await socialApi(req)
    if (social) return social
    if (url.pathname.startsWith('/api/')) return api(req, (runId, userId) => server.upgrade(req, {
      data: { runId, userId }, headers: { 'Sec-WebSocket-Protocol': 'heval' },
    }))
    if (!['GET', 'HEAD'].includes(req.method)) return new Response('Method not allowed', { status: 405 })
    const path = url.pathname === '/' || url.pathname === '/login' ? '/index.html'
      : url.pathname === '/studio' ? '/studio.html'
      : ['/reports', '/share', '/machines', '/evaluations'].includes(url.pathname) ? '/reports.html' : url.pathname
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
