import type { Authenticate } from './auth'
import type { createRunner } from './runner'
import { isHarness, RunnerError } from './types'
import { exportRuns } from './run-export'
import type { ConnectionStore } from './connections'
import type { createInferenceProxy } from './inference-proxy'

type Providers = { store: ConnectionStore; proxy: ReturnType<typeof createInferenceProxy> }
export function createApi(runner: ReturnType<typeof createRunner>, authenticate: Authenticate, enabled: boolean, exportsEnabled = false, allowedUsers?: Set<string>, providers?: Providers) {
  return async (req: Request, upgrade: (runId: string, userId: string) => boolean): Promise<Response | undefined> => {
    const url = new URL(req.url)
    if (url.pathname === '/api/health') return Response.json({ ok: true, runnerEnabled: enabled, exportsEnabled })
    const identity = await authenticate(req)
    if (!identity) return Response.json({ error: 'Sign in to access evaluations' }, { status: 401 })
    const { userId } = identity
    try {
      await runner.ready
      if (url.pathname === '/api/connections/merge-gateway') {
        if (!providers) return Response.json({ error: 'Provider connections are unavailable on this instance.' }, { status: 503 })
        const headers = { 'Cache-Control': 'no-store' }
        if (req.method === 'GET') return Response.json(providers.store.status(userId), { headers })
        if (allowedUsers && !allowedUsers.has(userId)) throw new RunnerError('Provider connections are available to invited evaluators.', 403)
        if (req.method === 'DELETE') {
          const status = providers.store.remove(userId)
          providers.proxy.revokeOwner(userId)
          for (const run of runner.runs.values()) if (run.ownerId === userId) runner.cancelRun(run)
          return Response.json(status, { headers })
        }
        if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
        const body = await req.json().catch(() => null)
        if (!body || !['connect', 'validate'].includes(body.action) || (body.action === 'connect' && typeof body.apiKey !== 'string')) throw new RunnerError('Choose connect or validate and provide a key when connecting.', 400)
        const status = await providers.store.validate(userId, body.action === 'connect' ? body.apiKey : undefined)
        if (body.action === 'connect') {
          providers.proxy.revokeOwner(userId)
          for (const run of runner.runs.values()) if (run.ownerId === userId) runner.cancelRun(run)
        }
        return Response.json(status, { headers })
      }
      if (url.pathname === '/api/config' && req.method === 'GET') {
        const connection = providers?.store.status(userId)
        return Response.json({ ...runner.configuration,
          ...(connection ? { models: runner.configuration.models.filter(model => connection.models.includes(model)), harnesses: ['pi-agent'], connectionRequired: !connection.connected, providerSettings: true } : {}),
          runnerEnabled: enabled, canRun: enabled && (!allowedUsers || allowedUsers.has(userId)) && (!connection || connection.connected),
        }, { headers: { 'Cache-Control': 'no-store' } })
      }
      if (url.pathname === '/api/runs/export' && req.method === 'GET') {
        const ids = [...new Set((url.searchParams.get('ids') || '').split(',').filter(Boolean))]
        if (!ids.length || ids.length > 100) return Response.json({ error: 'Select 1 to 100 attempts' }, { status: 400 })
        const runs = ids.map(id => runner.runs.get(id))
        if (runs.some(run => !run || run.ownerId !== userId)) return new Response('Not found', { status: 404 })
        return Response.json(exportRuns(runs.filter(run => run !== undefined)))
      }
      if (url.pathname === '/api/runs') {
        if (req.method === 'GET') return Response.json([...runner.runs.values()]
          .filter((run) => run.ownerId === userId)
          .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
          .map(run => ({ ...run, active: runner.isActive(run.id), chunks: undefined, grade: run.grade ? { ...run.grade, output: undefined } : undefined })))
        if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
        if (!enabled) return Response.json({ error: 'Runner is disabled or not configured' }, { status: 503 })
        if (allowedUsers && !allowedUsers.has(userId)) return Response.json({ error: 'Evaluation access is by invitation. Your account can browse the public project.' }, { status: 403 })
        const body = await req.json().catch(() => null)
        if (!isHarness(body?.harness)) return Response.json({ error: 'Unknown harness' }, { status: 400 })
        const config = { ...(body.model !== undefined ? { model: body.model } : {}), ...(body.task !== undefined ? { task: body.task } : {}), ...(body.timeoutMs !== undefined ? { timeoutMs: body.timeoutMs } : {}) }
        const connection = providers?.store.status(userId)
        if (connection && !connection.connected) throw new RunnerError('Connect Merge Gateway in Provider settings first.', 409)
        const model = config.model ?? runner.configuration.models[0]
        if (connection && (!connection.models.includes(model) || !runner.configuration.models.includes(model))) throw new RunnerError('Choose an available, server-approved model.', 400)
        if (providers && body.harness !== 'pi-agent') throw new RunnerError('Connected providers currently support Pi Agent.', 400)
        if (config.timeoutMs !== undefined && (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs < 1 || config.timeoutMs > runner.configuration.maxTimeoutMs)) throw new RunnerError('Choose a valid time limit.', 400)
        const access = providers?.proxy.issue(userId, model, Math.min(config.timeoutMs ?? runner.configuration.maxTimeoutMs, runner.configuration.maxTimeoutMs))
        let run
        try { run = runner.startRun(body.harness, userId, config, access) } catch (error) { access?.release(); throw error }
        await runner.persist(run.id)
        return Response.json({ id: run.id, harness: run.harness, status: run.status }, { status: 202 })
      }
      const match = url.pathname.match(/^\/api\/runs\/([^/]+)(?:\/(grade|stream|export))?$/)
      if (!match) return new Response('Not found', { status: 404 })
      const run = runner.runs.get(match[1])
      if (!run || run.ownerId !== userId) return new Response('Not found', { status: 404 })
      if (match[2] === 'export' && req.method === 'GET') return Response.json(exportRuns([run]))
      if (match[2] === 'grade' && req.method === 'POST') return Response.json(await runner.gradeRun(run))
      if (match[2] === 'stream' && req.method === 'GET') {
        if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket required', { status: 400 })
        return upgrade(run.id, userId) ? undefined : new Response('Upgrade failed', { status: 400 })
      }
      if (!match[2] && req.method === 'GET') {
        const after = Number(url.searchParams.get('after') || 0)
        if (!Number.isSafeInteger(after) || after < 0) return Response.json({ error: 'Invalid transcript offset' }, { status: 400 })
        const detail = await runner.getRun(run.id)
        return Response.json({ ...detail, chunks: detail?.chunks.slice(after) }, { headers: { 'Cache-Control': 'no-store' } })
      }
      if (!match[2] && req.method === 'DELETE') return Response.json({ cancelled: runner.cancelRun(run) })
      return new Response('Method not allowed', { status: 405 })
    } catch (error) {
      if (error instanceof RunnerError) return Response.json({ error: error.message }, { status: error.status })
      return Response.json({ error: 'Could not process evaluation request' }, { status: 500 })
    }
  }
}
