export type HarnessId = 'claude-code' | 'codex' | 'opencode' | 'pi-agent'
export type Chunk = { at: number; data: string }
export type Grade = { passed: boolean; exitCode: number; output: string }
export type Run = {
  id: string
  ownerId: string
  harness: HarnessId
  model: string
  gateway: 'merge-gateway'
  status: 'running' | 'grading' | 'complete' | 'failed' | 'cancelled' | 'timed-out'
  startedAt: string
  exitCode?: number
  chunks: Chunk[]
  grade?: Grade
  error?: string
}
export function isHarness(value: unknown): value is HarnessId {
  return value === 'claude-code' || value === 'codex' || value === 'opencode' || value === 'pi-agent'
}
export class RunnerError extends Error {
  constructor(message: string, public status = 503) { super(message) }
}
