import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { readTranscript, restoreRuns, saveSummary } from './history'
import { type WorkerBackend, type WorkerProcess, type RunAccess } from './docker'
import { Recording } from './recording'
import { RunnerError, type HarnessId, type Run, type RunConfig } from './types'
export { isHarness } from './types'
export type { HarnessId, Run, Chunk, Grade } from './types'

type Socket = { send(data: string): unknown }
type Options = {
  backend: WorkerBackend; directory: string; maxConcurrent: number; maxPerUser: number
  allowedModels?: string[]; maxDailyPerUser?: number
  timeoutMs: number; gradeTimeoutMs: number; maxOutputBytes: number; model: string; secret?: string; provider?: 'merge-gateway' | 'nvidia'
}

export function createRunner(options: Options) {
  const runs = new Map<string, Run>()
  const subscribers = new Map<string, Set<Socket>>()
  const accepted = new Map<string, Promise<void>>()
  const active = new Map<string, { ownerId: string; stop: () => Promise<void>; done: Promise<void> }>()
  let cleanupFailed = false
  let shuttingDown = false
  const models = options.allowedModels ?? [options.model]
  let recovering = true
  const ready = restoreRuns(options.directory).then(async (saved) => {
    for (const run of saved) {
      if (run.cleanupPending || ['running', 'grading'].includes(run.status)) {
        try { await options.backend.cleanup(run.id); run.cleanupPending = false } catch { cleanupFailed = true; run.cleanupPending = true }
        run.status = 'failed'
        run.error = cleanupFailed ? 'Interrupted by restart; worker cleanup requires operator attention' : 'Interrupted by server restart'
        run.finishedAt = new Date().toISOString()
        await saveSummary(options.directory, run)
      }
      if (!runs.has(run.id)) runs.set(run.id, run)
    }
    recovering = false
  })
  // Requests await ready; retain the rejection without an unhandled promise.
  void ready.catch(() => {})
  function emit(run: Run, event: object) {
    for (const socket of subscribers.get(run.id) ?? []) {
      try { socket.send(JSON.stringify(event)) } catch { subscribers.get(run.id)?.delete(socket) }
    }
  }
  function startRun(harness: HarnessId, ownerId: string, requested: Partial<RunConfig> = {}, access?: RunAccess): Run {
    const config: RunConfig = { model: options.model, task: 'concurrent-cache-v1', timeoutMs: options.timeoutMs, ...requested }
    if (access && harness !== 'pi-agent') throw new RunnerError('Connected providers currently support Pi Agent', 400)
    if (!access && options.provider === 'nvidia' && harness !== 'pi-agent') throw new RunnerError('Direct NVIDIA access currently supports Pi Agent', 400)
    if (!models.includes(config.model) || config.task !== 'concurrent-cache-v1' || !Number.isSafeInteger(config.timeoutMs) || config.timeoutMs < 1 || config.timeoutMs > options.timeoutMs) throw new RunnerError('Unsupported model, task, or time limit', 400)
    if (!ownerId) throw new RunnerError('A run owner is required', 401)
    if (shuttingDown) throw new RunnerError('Runner is shutting down')
    if (cleanupFailed) throw new RunnerError('Worker cleanup failed; check Docker resources and restart')
    if (active.size >= options.maxConcurrent || [...active.values()].filter((r) => r.ownerId === ownerId).length >= options.maxPerUser) {
      throw new RunnerError('Evaluation capacity reached; retry after an active run finishes', 429)
    }
    const today = new Date().toISOString().slice(0, 10)
    if ([...runs.values()].filter((run) => run.ownerId === ownerId && run.startedAt.startsWith(today)).length >= (options.maxDailyPerUser ?? 20)) throw new RunnerError('Daily evaluation limit reached', 429)
    for (const [id, previous] of runs) {
      if (!active.has(id)) { previous.chunks = []; subscribers.delete(id) }
    }
    const run: Run = { id: crypto.randomUUID(), ownerId, harness, ...config, taskChecksum: createHash('sha256').update(readFileSync(join(import.meta.dir, '../fixtures/concurrent-cache/src/cache.ts'))).update(readFileSync(join(import.meta.dir, '../fixtures/concurrent-cache/cache.test.ts'))).digest('hex'), costUsd: null, totalTokens: null,
      gateway: access ? 'merge-gateway' : options.provider ?? 'merge-gateway', status: 'running', startedAt: new Date().toISOString(), chunks: [] }
    runs.set(run.id, run)
    let worker: WorkerProcess | undefined
    let stopping: Promise<void> | undefined
    let bytes = 0
    let rawBytes = 0
    const started = performance.now()
    const stop = () => {
      access?.release()
      if (!worker) return Promise.resolve()
      return stopping ??= worker.stop().catch(() => {})
    }
    const recording = new Recording(options.directory, run.id, () => ({ ...run, chunks: undefined, outputBytes: bytes }), () => {
      run.error = 'Recording write failed'; run.status = 'failed'; void stop()
    })
    const persisted = ready.then(() => recording.checkpoint())
    accepted.set(run.id, persisted)
    void persisted.catch(() => {})
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
      const secret = access?.apiKey ?? options.secret
      if (!secret) { tail = ''; record(text); return }
      let end = final ? text.length : Math.max(0, text.length - secret.length + 1)
      const crossing = text.lastIndexOf(secret, end - 1)
      if (crossing >= 0 && crossing < end && crossing + secret.length > end) end = crossing
      record(text.slice(0, end).split(secret).join('[REDACTED]'))
      tail = text.slice(end)
    }
    async function execute() {
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeout = (ms: number, stage: 'agent' | 'grader') => {
        clearTimeout(timer)
        timer = setTimeout(() => { run.timeoutStage = stage; run.status = 'timed-out'; run.error = 'Worker time limit exceeded'; void stop() }, ms)
      }
      try {
        if (recovering) await ready
        if (cleanupFailed) throw new Error('Recovery cleanup failed')
        await persisted
        if (run.status !== 'running') return
        worker = options.backend.start(run.id, harness, output, config, access)
        timeout(config.timeoutMs, 'agent')
        run.exitCode = await worker.exited
        run.agentFinishedAt = new Date().toISOString()
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
        timeout(options.gradeTimeoutMs, 'grader')
        const exitCode = await worker.exited
        output('', true)
        if (run.status !== 'grading') return
        run.grade = { passed: exitCode === 0, exitCode,
          output: (access?.apiKey ?? options.secret) ? gradeOutput.split((access?.apiKey ?? options.secret)!).join('[REDACTED]') : gradeOutput }
        run.status = run.grade.passed ? 'complete' : 'failed'
        emit(run, { type: 'grade', grade: run.grade, status: run.status })
      } catch {
        run.status = 'failed'
        run.error = 'Worker unavailable or failed. Check Docker and the configured worker image.'
      } finally {
        clearTimeout(timer)
        access?.release()
        if (stopping) await stopping
        try { await options.backend.cleanup(run.id) } catch {
          cleanupFailed = true; run.cleanupPending = true
          run.status = 'failed'; run.error = 'Worker cleanup failed; check Docker before restarting'
        }
        run.finishedAt = new Date().toISOString()
        recording.append({ type: 'exit', status: run.status, exitCode: run.exitCode, grade: run.grade, error: run.error })
        try { await recording.close() } catch { run.status = 'failed'; run.error = 'Recording write failed' }
        emit(run, { type: 'exit', status: run.status, exitCode: run.exitCode, run: { ...run, chunks: undefined } })
        active.delete(run.id); accepted.delete(run.id)
      }
    }
    // Reserve capacity before Docker or filesystem work can yield.
    const slot = { ownerId, stop, done: Promise.resolve() }
    active.set(run.id, slot)
    slot.done = Promise.resolve().then(execute)
    return run
  }
  return {
    runs, subscribers, startRun, ready,
    isActive: (id: string) => active.has(id),
    async persist(id: string) { await accepted.get(id) },
    configuration: { models, harnesses: options.provider === 'nvidia' ? ['pi-agent'] : ['pi-agent', 'codex', 'opencode', 'claude-code'], tasks: [{ id: 'concurrent-cache-v1', label: 'Async cache race condition', description: 'Repair a public TypeScript fixture. A fresh container runs the pinned tests.' }], maxTimeoutMs: options.timeoutMs, maxDailyPerUser: options.maxDailyPerUser ?? 20 },
    async getRun(id: string) {
      await ready
      const run = runs.get(id)
      if (!run) return undefined
      return { ...run, active: active.has(id), chunks: active.has(id) ? run.chunks : await readTranscript(options.directory, id) }
    },
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
