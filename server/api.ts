import type { Authenticate } from './auth'
import type { createRunner } from './runner'
import { isHarness, RunnerError } from './types'

export function createApi(runner: ReturnType<typeof createRunner>, authenticate: Authenticate, enabled: boolean, exportsEnabled = false) {
  return async (req: Request, upgrade: (runId: string, userId: string) => boolean): Promise<Response | undefined> => {
    const url = new URL(req.url)
    if (url.pathname === '/api/health') return Response.json({ ok: true, runnerEnabled: enabled, exportsEnabled })
    const identity = await authenticate(req)
    if (!identity) return Response.json({ error: 'Sign in to access evaluations' }, { status: 401 })
    const { userId } = identity
    try {
      if (url.pathname === '/api/runs') {
        if (req.method === 'GET') return Response.json([...runner.runs.values()]
          .filter((run) => run.ownerId === userId)
          .map(({ id, harness, status, startedAt, exitCode, grade, error }) => ({ id, harness, status, startedAt, exitCode, grade, error })))
        if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
        if (!enabled) return Response.json({ error: 'Runner is disabled or not configured' }, { status: 503 })
        const body = await req.json().catch(() => null)
        if (!isHarness(body?.harness)) return Response.json({ error: 'Unknown harness' }, { status: 400 })
        const run = runner.startRun(body.harness, userId)
        return Response.json({ id: run.id, harness: run.harness, status: run.status }, { status: 202 })
      }
      const match = url.pathname.match(/^\/api\/runs\/([^/]+)(?:\/(grade|stream))?$/)
      if (!match) return new Response('Not found', { status: 404 })
      const run = runner.runs.get(match[1])
      if (!run || run.ownerId !== userId) return new Response('Not found', { status: 404 })
      if (match[2] === 'grade' && req.method === 'POST') return Response.json(await runner.gradeRun(run))
      if (match[2] === 'stream' && req.method === 'GET') {
        if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket required', { status: 400 })
        return upgrade(run.id, userId) ? undefined : new Response('Upgrade failed', { status: 400 })
      }
      if (!match[2] && req.method === 'GET') return Response.json(run)
      if (!match[2] && req.method === 'DELETE') return Response.json({ cancelled: runner.cancelRun(run) })
      return new Response('Method not allowed', { status: 405 })
    } catch (error) {
      if (error instanceof RunnerError) return Response.json({ error: error.message }, { status: error.status })
      return Response.json({ error: 'Could not process evaluation request' }, { status: 500 })
    }
  }
}
