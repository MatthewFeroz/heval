import { join } from 'node:path'
import { dockerBackend } from './docker'
import { createRunner } from './runner'

function limit(name: string, fallback: number, max: number) {
  const value = Number(process.env[name] ?? fallback)
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error(`Invalid ${name}`)
  return value
}
export function createConfiguredRunner() {
  return createRunner({
  backend: dockerBackend(process.env.HEVAL_WORKER_IMAGE || 'heval-worker:local'),
  directory: process.env.HEVAL_DATA_DIR ? join(process.env.HEVAL_DATA_DIR, 'recordings') : join(import.meta.dir, '..', 'recordings'),
  allowedModels: (process.env.HEVAL_ALLOWED_MODELS || process.env.HEVAL_GATEWAY_MODEL || 'anthropic/claude-sonnet-4-5-20250929').split(',').map(value => value.trim()).filter(Boolean),
  maxDailyPerUser: limit('HEVAL_MAX_DAILY_RUNS_PER_USER', 20, 1000),
  maxConcurrent: limit('HEVAL_MAX_CONCURRENT_RUNS', 2, 32),
  maxPerUser: limit('HEVAL_MAX_RUNS_PER_USER', 1, 32),
  timeoutMs: limit('HEVAL_RUN_TIMEOUT_MS', 300_000, 3_600_000),
  gradeTimeoutMs: limit('HEVAL_GRADE_TIMEOUT_MS', 30_000, 300_000),
  maxOutputBytes: limit('HEVAL_MAX_OUTPUT_BYTES', 8 * 1024 * 1024, 64 * 1024 * 1024),
  model: process.env.HEVAL_GATEWAY_MODEL || 'anthropic/claude-sonnet-4-5-20250929',
  secret: process.env.HEVAL_PROVIDER === 'nvidia' ? process.env.HEVAL_NVIDIA_API_KEY : process.env.HEVAL_GATEWAY_API_KEY,
  provider: process.env.HEVAL_PROVIDER === 'nvidia' ? 'nvidia' : 'merge-gateway',
})
}
