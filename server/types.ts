export type HarnessId = 'claude-code' | 'codex' | 'opencode' | 'pi-agent'
export type Chunk = { at: number; data: string }
export type Grade = { passed: boolean; exitCode: number; output: string }
export type RunConfig = { model: string; task: 'concurrent-cache-v1'; timeoutMs: number }
export type Run = {
  id: string
  ownerId: string
  harness: HarnessId
  model: string
  gateway: 'merge-gateway' | 'nvidia'
  status: 'running' | 'grading' | 'complete' | 'failed' | 'cancelled' | 'timed-out'
  startedAt: string
  active?: boolean
  timeoutStage?: 'agent' | 'grader'
  finishedAt?: string
  agentFinishedAt?: string
  task?: string
  timeoutMs?: number
  taskChecksum?: string
  costUsd?: number | null
  totalTokens?: number | null
  exitCode?: number
  chunks: Chunk[]
  grade?: Grade
  cleanupPending?: boolean
  error?: string
}
export function isHarness(value: unknown): value is HarnessId {
  return value === 'claude-code' || value === 'codex' || value === 'opencode' || value === 'pi-agent'
}
export class RunnerError extends Error {
  constructor(message: string, public status = 503) { super(message) }
}
