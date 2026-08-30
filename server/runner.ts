import { cpSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export type HarnessId = 'claude-code' | 'codex' | 'opencode' | 'pi-agent'
export type Chunk = { at: number; data: string }
export type Run = { id: string; harness: HarnessId; status: 'running' | 'complete' | 'failed'; startedAt: string; exitCode?: number; chunks: Chunk[]; terminal?: Bun.Terminal }

const prompt = 'Fix the race condition in the async cache and make the full test suite pass. Preserve the public API.'
const commands: Record<HarnessId, string[]> = {
  'claude-code': ['claude', '--dangerously-skip-permissions', '--model', 'opus', prompt],
  codex: ['codex', '--dangerously-bypass-approvals-and-sandbox', '--model', 'gpt-5.6-sol', prompt],
  opencode: ['opencode', '--auto', '--model', 'openai/gpt-5.6', '--prompt', prompt],
  'pi-agent': [join(process.cwd(), 'node_modules', '.bin', 'pi'), '--model', 'openai/gpt-5.6', prompt],
}

export const runs = new Map<string, Run>()
export const subscribers = new Map<string, Set<{ send(data: string): unknown }>>()

function emit(run: Run, message: object) {
  const payload = JSON.stringify(message)
  subscribers.get(run.id)?.forEach((socket) => socket.send(payload))
}

export function startRun(harness: HarnessId) {
  const fixture = join(import.meta.dir, '..', 'fixtures', 'concurrent-cache')
  if (!existsSync(fixture)) throw new Error('Pinned fixture is missing')
  const workspace = mkdtempSync(join(tmpdir(), `heval-${harness}-`))
  cpSync(fixture, workspace, { recursive: true })
  const id = crypto.randomUUID()
  const started = performance.now()
  const run: Run = { id, harness, status: 'running', startedAt: new Date().toISOString(), chunks: [] }
  runs.set(id, run)
  mkdirSync(join(import.meta.dir, '..', 'recordings'), { recursive: true })

  const proc = Bun.spawn(commands[harness], {
    cwd: workspace,
    env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
    terminal: {
      cols: 96,
      rows: 24,
      data(_terminal, bytes) {
        const chunk = { at: Math.round(performance.now() - started), data: new TextDecoder().decode(bytes) }
        run.chunks.push(chunk)
        writeFileSync(join(import.meta.dir, '..', 'recordings', `${id}.json`), JSON.stringify({ ...run, terminal: undefined }))
        emit(run, { type: 'data', ...chunk })
      },
    },
  })
  run.terminal = proc.terminal
  void proc.exited.then((exitCode) => {
    run.exitCode = exitCode
    run.status = exitCode === 0 ? 'complete' : 'failed'
    run.terminal?.close()
    run.terminal = undefined
    void Bun.write(join(import.meta.dir, '..', 'recordings', `${id}.json`), JSON.stringify(run))
    emit(run, { type: 'exit', exitCode, status: run.status })
  })
  return run
}

export function isHarness(value: unknown): value is HarnessId {
  return typeof value === 'string' && value in commands
}
