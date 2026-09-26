/** Public descriptions only. Commands, local paths and provider secrets stay on the runner. */
export type RunnerProfile = {
  id: string; digest: string; title: string; benchmark: string; agent: string; model: string
  tasks: number; attempts: number; timeoutSeconds: number; setupCheck: boolean
  taskSet?: string; vendor?: string; maxAttempts?: number; runSettingsVersion?: 1
}
/** Explicit overrides; omitted resources retain each benchmark task's requirements. */
export type RunSettings = { concurrency: number; retries: number; cpus?: number; memoryMb?: number; timeoutSeconds?: number }
export function validateRunSettings(profile: RunnerProfile, settings?: RunSettings): void {
  if (!settings) return
  if (profile.runSettingsVersion !== 1) throw new Error('Update this worker to configure parallel trials and resources.')
  for (const [key, value] of Object.entries(settings)) {
    if (!['concurrency', 'retries', 'cpus', 'memoryMb', 'timeoutSeconds'].includes(key) || !Number.isSafeInteger(value) || value < (key === 'retries' ? 0 : key === 'timeoutSeconds' ? 30 : 1)) throw new Error('Use whole numbers: positive resources and concurrency, nonnegative retries, and a deadline of at least 30 seconds.')
  }
  if (settings.concurrency === undefined || settings.retries === undefined || !Number.isSafeInteger(settings.retries + 1) || (settings.timeoutSeconds !== undefined && !Number.isSafeInteger(settings.timeoutSeconds * 1000))) throw new Error('Invalid run settings.')
  for (const value of [settings.cpus, settings.memoryMb]) if (value !== undefined && !Number.isSafeInteger(value * settings.concurrency)) throw new Error('Combined resource request exceeds numeric precision.')
}
export function executionTimeoutSeconds(profile: RunnerProfile, attempts?: number, settings?: RunSettings) {
  validateRunSettings(profile, settings)
  const fallback = runTimeoutSeconds(profile, attempts)
  return settings?.timeoutSeconds ?? fallback
}
export const PROTOCOL_VERSION = 1
/** Paired, unrevoked workers per account. Each run executes on exactly one of them. */
export const MAX_WORKERS = 3
/**
 * What a worker's host is, for its icon. Detected on the host (not inside the
 * worker container, which would read as a VM) and overridable per worker.
 */
export const MACHINE_KINDS = ['laptop', 'desktop', 'mac-mini', 'mac-studio', 'server', 'cloud', 'linux'] as const
export type MachineKind = typeof MACHINE_KINDS[number]
export const isMachineKind = (value: unknown): value is MachineKind => typeof value === 'string' && (MACHINE_KINDS as readonly string[]).includes(value)
export const RUNNER_ONLINE_MS = 45_000
export const RUNNER_LEASE_MS = 30_000
export const terminalStates = ['completed', 'failed', 'cancelled', 'interrupted'] as const
export type RunStatus = 'queued' | 'running' | 'cancelling' | typeof terminalStates[number]
export function validateProfiles(profiles: RunnerProfile[]) {
  if (new Set(profiles.map(p => p.id)).size !== profiles.length) throw new Error('Use profiles with unique IDs.')
  for (const p of profiles) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(p.id) || !/^[a-f0-9]{64}$/.test(p.digest)) throw new Error('Invalid profile identity.')
    for (const label of [p.title, p.benchmark, p.agent, p.model]) if (!label.trim() || label.length > 160 || [...label].some(c => c.charCodeAt(0) < 32)) throw new Error('Use short profile labels.')
    if (p.taskSet !== undefined && !/^[a-f0-9]{64}$/.test(p.taskSet)) throw new Error('Invalid task set identity.')
    if (p.vendor !== undefined && (!p.vendor.trim() || p.vendor.length > 160 || [...p.vendor].some(c => c.charCodeAt(0) < 32))) throw new Error('Invalid vendor.')
    if (p.maxAttempts !== undefined && (!Number.isSafeInteger(p.maxAttempts) || p.maxAttempts < p.attempts || !Number.isSafeInteger(p.maxAttempts * p.tasks))) throw new Error('Invalid approved attempt limit.')
    if (![p.tasks, p.attempts, p.timeoutSeconds].every(Number.isSafeInteger) || p.tasks < 1 || p.attempts < 1 || !Number.isSafeInteger(p.tasks * p.attempts) || p.timeoutSeconds < 30) throw new Error('Profiles require positive safe integer task and attempt counts and a time limit of at least 30 seconds.')
    runTimeoutSeconds(p, p.maxAttempts ?? p.attempts)
  }
  return profiles
}

/** timeoutSeconds is the budget for the profile's configured attempts across all tasks. */
export function runTimeoutSeconds(profile: RunnerProfile, attempts = profile.attempts): number {
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > (profile.maxAttempts ?? profile.attempts) || !Number.isSafeInteger(attempts * profile.tasks)) throw new Error('Requested attempts exceed this machine’s approval.')
  const seconds = Math.ceil(profile.timeoutSeconds / profile.attempts * attempts)
  if (!Number.isSafeInteger(seconds) || seconds < 1 || !Number.isSafeInteger(seconds * 1000)) throw new Error('Run deadline exceeds safe numeric precision.')
  return seconds
}
