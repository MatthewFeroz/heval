import { randomBytes } from 'node:crypto'
import type { ConnectionStore } from './connections'
import type { RunAccess } from './docker'

type Lease = { owner: string; model: string; expires: number; remaining: number; vendor?: string; controllers: Set<AbortController> }
export function createInferenceProxy(connections: Pick<ConnectionStore, 'secret'>, baseUrl: string, upstream: typeof fetch = fetch) {
  const leases = new Map<string, Lease>()
  function revoke(token: string) {
    const lease = leases.get(token)
    leases.delete(token)
    for (const controller of lease?.controllers ?? []) controller.abort()
  }
  return {
    issue(owner: string, model: string, timeoutMs: number, vendor?: string): RunAccess {
      const token = randomBytes(32).toString('hex')
      leases.set(token, { owner, model, vendor, expires: Date.now() + timeoutMs, remaining: 40, controllers: new Set() })
      const timer = setTimeout(() => revoke(token), timeoutMs); timer.unref()
      return { apiKey: token, baseUrl, release() { clearTimeout(timer); revoke(token) } }
    },
    revokeOwner(owner: string) { for (const [token, lease] of leases) if (lease.owner === owner) revoke(token) },
    async handle(req: Request): Promise<Response> {
      const json = (error: string, status: number) => Response.json({ error: { message: error, type: 'heval_proxy_error' } }, { status, headers: { 'Cache-Control': 'no-store' } })
      if (new URL(req.url).pathname !== '/api/inference/chat/completions') return json('Endpoint unavailable', 404)
      const token = req.headers.get('authorization')?.replace(/^Bearer /, '') || ''
      const lease = leases.get(token)
      if (!lease || lease.expires <= Date.now()) return json('Run token expired or revoked', 401)
      if (req.method !== 'POST') return json('Method not allowed', 405)
      if (lease.remaining <= 0 || lease.controllers.size >= 1) return json('Run inference limit reached', 429)
      const body = await req.json().catch(() => null)
      if (!body || body.model !== lease.model || !Array.isArray(body.messages)) return json('Request must use the model selected for this run', 400)
      if (leases.get(token) !== lease || lease.expires <= Date.now()) return json('Run token revoked', 401)
      if (lease.remaining <= 0 || lease.controllers.size >= 1) return json('Run inference limit reached', 429)
      // Forward only supported inference fields, never caller URLs, routing or headers.
      const payload: Record<string, unknown> = { model: lease.model, messages: body.messages,
        max_tokens: Math.min(8192, Math.max(1, Number.isSafeInteger(body.max_tokens) ? body.max_tokens : 8192)) }
      if (lease.vendor) payload.vendor = lease.vendor
      for (const field of ['tools', 'tool_choice', 'temperature', 'top_p', 'stop', 'stream', 'stream_options', 'parallel_tool_calls', 'response_format']) {
        if (body[field] !== undefined) payload[field] = body[field]
      }
      const controller = new AbortController()
      lease.controllers.add(controller); lease.remaining--
      const timer = setTimeout(() => controller.abort(), Math.min(120000, lease.expires - Date.now()))
      const abort = () => controller.abort()
      req.signal.addEventListener('abort', abort, { once: true })
      function finish() { clearTimeout(timer); lease!.controllers.delete(controller); req.signal.removeEventListener('abort', abort) }
      try {
        if (req.signal.aborted) controller.abort()
        const response = await upstream('https://api-gateway.merge.dev/v1/openai/chat/completions', {
          method: 'POST', headers: { Authorization: `Bearer ${connections.secret(lease.owner)}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload), redirect: 'error', signal: controller.signal,
        })
        if (!response.ok || !response.body) {
          await response.body?.cancel(); finish()
          return json(response.status === 401 || response.status === 403 ? 'Provider authentication failed. Revalidate your connection in Settings.' : 'Provider request failed. Retry or check your Gateway account.', response.status === 429 ? 429 : 502)
        }
        const reader = response.body.getReader()
        return new Response(new ReadableStream({
          async pull(output) {
            try { const part = await reader.read(); if (part.done) { finish(); output.close() } else output.enqueue(part.value) }
            catch { finish(); output.error(new Error('Provider stream interrupted')) }
          },
          async cancel() { controller.abort(); finish(); await reader.cancel() },
        }), { headers: { 'Content-Type': response.headers.get('content-type') || 'application/json', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } })
      } catch { finish(); return json('Inference unavailable or run cancelled', 502) }
    },
  }
}
