import { runManagedCoordinator } from './coordinator'
const controller = new AbortController()
let lastHeartbeat = 0
const server = Bun.serve({ port: Number(process.env.PORT ?? 8080), fetch(request) {
  if (new URL(request.url).pathname !== '/health') return new Response('Not found', { status: 404 })
  const healthy = Date.now() - lastHeartbeat < 180_000
  return Response.json({ status: healthy ? 'ok' : 'starting' }, { status: healthy ? 200 : 503 })
} })
for (const event of ['SIGTERM', 'SIGINT'] as const) process.once(event, () => controller.abort())
try { await runManagedCoordinator(controller.signal, () => { lastHeartbeat = Date.now() }) }
catch { console.error('Managed coordinator startup failed. Check its server configuration and provider access.'); process.exitCode = 1 }
finally { await server.stop(); }
