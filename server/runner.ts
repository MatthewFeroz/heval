import { join } from 'node:path'
import { dockerBackend, type WorkerBackend, type WorkerProcess } from './docker'
import { Recording } from './recording'
import { RunnerError, type HarnessId, type Run } from './types'
export { isHarness } from './types'
export type { HarnessId, Run, Chunk, Grade } from './types'

type Socket = { send(data: string): unknown }
type Options = {
  backend: WorkerBackend; directory: string; maxConcurrent: number; maxPerUser: number
  timeoutMs: number; gradeTimeoutMs: number; maxOutputBytes: number; model: string; secret?: string
}

export function createRunner(options: Options) {
  const runs = new Map<string, Run>()
  const subscribers = new Map<string, Set<Socket>>()
  const active = new Map<string, { ownerId: string; stop: () => Promise<void>; done: Promise<void> }>()
  let cleanupFailed = false
  let shuttingDown = false
  function emit(run: Run, event: object) {
    for (const socket of subscribers.get(run.id) ?? []) {
      try { socket.send(JSON.stringify(event)) } catch { subscribers.get(run.id)?.delete(socket) }
    }
  }
  function startRun(harness: HarnessId, ownerId: string): Run {
    if (!ownerId) throw new RunnerError('A run owner is required', 401)
    if (shuttingDown) throw new RunnerError('Runner is shutting down')
    if (cleanupFailed) throw new RunnerError('Worker cleanup failed; check Docker resources and restart')
    if (active.size >= options.maxConcurrent || [...active.values()].filter((r) => r.ownerId === ownerId).length >= options.maxPerUser) {
      throw new RunnerError('Evaluation capacity reached; retry after an active run finishes', 429)
    }
    for (const [id] of runs) {
      if (runs.size < 100) break
      if (!active.has(id)) { runs.delete(id); subscribers.delete(id) }
    }
    const run: Run = { id: crypto.randomUUID(), ownerId, harness, model: options.model,
      gateway: 'merge-gateway', status: 'running', startedAt: new Date().toISOString(), chunks: [] }
    runs.set(run.id, run)
    let worker: WorkerProcess | undefined
    let stopping: Promise<void> | undefined
    let bytes = 0
    let rawBytes = 0
    const started = performance.now()
    const stop = () => {
      if (!worker) return Promise.resolve()
      return stopping ??= worker.stop().catch(() => {})
    }
    const recording = new Recording(options.directory, run.id, () => ({ ...run, chunks: undefined, outputBytes: bytes }), () => {
      run.error = 'Recording write failed'; run.status = 'failed'; void stop()
    })
    function record(data: string) {
      if (!data) return
      const size = Buffer.byteLength(data)
      if (bytes + size > options.maxOutputBytes) {
        run.error = 'Output limit exceeded'; run.status = 'failed'; void stop(); return
      }
      bytes += size
      const chunk = { at: Math.round(performance.now() - started), data }
      run.chunks.push(chunk)
      recording.append({ type: 'data', ...chunk })
      emit(run, { type: 'data', ...chunk })
    }
    // Retain a short tail to redact credentials split across transport chunks.
    let tail = ''
    function output(data: string, final = false) {
      rawBytes += Buffer.byteLength(data)
      if (rawBytes > options.maxOutputBytes) {
        run.error = 'Output limit exceeded'; run.status = 'failed'; void stop(); return
      }
      const text = tail + data
      const secret = options.secret
      if (!secret) { tail = ''; record(text); return }
      let end = final ? text.length : Math.max(0, text.length - secret.length + 1)
      const crossing = text.lastIndexOf(secret, end - 1)
      if (crossing >= 0 && crossing < end && crossing + secret.length > end) end = crossing
      record(text.slice(0, end).split(secret).join('[REDACTED]'))
      tail = text.slice(end)
    }
    async function execute() {
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeout = (ms: number) => {
        clearTimeout(timer)
        timer = setTimeout(() => { run.status = 'timed-out'; run.error = 'Worker time limit exceeded'; void stop() }, ms)
      }
      try {
        if (run.status !== 'running') return
        worker = options.backend.start(run.id, harness, output)
        timeout(options.timeoutMs)
        run.exitCode = await worker.exited
        output('', true)
        if (run.status !== 'running') return
        if (run.exitCode !== 0) { run.status = 'failed'; return }
        run.status = 'grading'
        emit(run, { type: 'status', status: run.status })
        let gradeOutput = ''
        stopping = undefined
        worker = options.backend.grade(run.id, (data) => {
          gradeOutput = (gradeOutput + data).slice(-16_000)
          output(data)
        })
        timeout(options.gradeTimeoutMs)
        const exitCode = await worker.exited
        output('', true)
        if (run.status !== 'grading') return
        run.grade = { passed: exitCode === 0, exitCode,
          output: options.secret ? gradeOutput.split(options.secret).join('[REDACTED]') : gradeOutput }
        run.status = run.grade.passed ? 'complete' : 'failed'
        emit(run, { type: 'grade', grade: run.grade, status: run.status })
      } catch {
        run.status = 'failed'
        run.error = 'Worker unavailable or failed. Check Docker and the configured worker image.'
      } finally {
        clearTimeout(timer)
        if (stopping) await stopping
        try { await options.backend.cleanup(run.id) } catch {
          cleanupFailed = true
          run.status = 'failed'; run.error = 'Worker cleanup failed; check Docker before restarting'
        }
        recording.append({ type: 'exit', status: run.status, exitCode: run.exitCode, grade: run.grade, error: run.error })
        try { await recording.close() } catch { run.status = 'failed'; run.error = 'Recording write failed' }
        emit(run, { type: 'exit', status: run.status, exitCode: run.exitCode })
        active.delete(run.id)
      }
    }
    // Reserve capacity before Docker or filesystem work can yield.
    const slot = { ownerId, stop, done: Promise.resolve() }
    active.set(run.id, slot)
    slot.done = Promise.resolve().then(execute)
    return run
  }
  return {
    runs, subscribers, startRun,
    cancelRun(run: Run) {
      const slot = active.get(run.id)
      if (!slot || !['running', 'grading'].includes(run.status)) return false
      run.status = 'cancelled'; void slot.stop(); return true
    },
    async gradeRun(run: Run) {
      if (run.grade) return run.grade
      throw new RunnerError('Grading runs automatically after the agent succeeds; no grade is available yet', 409)
    },
    async wait(id: string) { await active.get(id)?.done },
    async shutdown() {
      shuttingDown = true
      for (const [id] of active) this.cancelRun(runs.get(id)!)
      await Promise.all([...active.values()].map((slot) => slot.done))
    },
  }
}

function limit(name: string, fallback: number, max: number) {
  const value = Number(process.env[name] ?? fallback)
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error(`Invalid ${name}`)
  return value
}
export const runner = createRunner({
  backend: dockerBackend(process.env.HEVAL_WORKER_IMAGE || 'heval-worker:local'),
  directory: join(import.meta.dir, '..', 'recordings'),
  maxConcurrent: limit('HEVAL_MAX_CONCURRENT_RUNS', 2, 32),
  maxPerUser: limit('HEVAL_MAX_RUNS_PER_USER', 1, 32),
  timeoutMs: limit('HEVAL_RUN_TIMEOUT_MS', 300_000, 3_600_000),
  gradeTimeoutMs: limit('HEVAL_GRADE_TIMEOUT_MS', 30_000, 300_000),
  maxOutputBytes: limit('HEVAL_MAX_OUTPUT_BYTES', 8 * 1024 * 1024, 64 * 1024 * 1024),
  model: process.env.HEVAL_GATEWAY_MODEL || 'anthropic/claude-sonnet-4-5-20250929',
  secret: process.env.HEVAL_GATEWAY_API_KEY,
})
