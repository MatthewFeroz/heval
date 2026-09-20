/** Public descriptions only. Commands, local paths and provider secrets stay on the runner. */
export type RunnerProfile = {
  id: string; digest: string; title: string; benchmark: string; agent: string; model: string
  tasks: number; attempts: number; timeoutSeconds: number; setupCheck: boolean
  taskSet?: string; vendor?: string; maxAttempts?: number
}
export const PROTOCOL_VERSION = 1
export const RUNNER_ONLINE_MS = 45_000
export const RUNNER_LEASE_MS = 30_000
export const MAX_RUNNER_PROFILES = 20
export const MAX_RUNNER_TRIALS = 60
export const terminalStates = ['completed', 'failed', 'cancelled', 'interrupted'] as const
export type RunStatus = 'queued' | 'running' | 'cancelling' | typeof terminalStates[number]
export function validateProfiles(profiles: RunnerProfile[]) {
  if (profiles.length > MAX_RUNNER_PROFILES || new Set(profiles.map(p => p.id)).size !== profiles.length) throw new Error('Use up to 20 profiles with unique IDs.')
  for (const p of profiles) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(p.id) || !/^[a-f0-9]{64}$/.test(p.digest)) throw new Error('Invalid profile identity.')
    for (const label of [p.title, p.benchmark, p.agent, p.model]) if (!label.trim() || label.length > 160 || [...label].some(c => c.charCodeAt(0) < 32)) throw new Error('Use short profile labels.')
    if (p.taskSet !== undefined && !/^[a-f0-9]{64}$/.test(p.taskSet)) throw new Error('Invalid task set identity.')
    if (p.vendor !== undefined && (!p.vendor.trim() || p.vendor.length > 160 || [...p.vendor].some(c => c.charCodeAt(0) < 32))) throw new Error('Invalid vendor.')
    if (p.maxAttempts !== undefined && (!Number.isSafeInteger(p.maxAttempts) || p.maxAttempts < p.attempts || p.maxAttempts * p.tasks > MAX_RUNNER_TRIALS)) throw new Error('Invalid approved attempt limit.')
    if (![p.tasks, p.attempts, p.timeoutSeconds].every(Number.isSafeInteger) || p.tasks < 1 || p.attempts < 1 || p.tasks * p.attempts > MAX_RUNNER_TRIALS || p.timeoutSeconds < 30 || p.timeoutSeconds > 7200) throw new Error('Profiles require 1–60 trials and a 30–7200 second time limit.')
  }
  return profiles
}
