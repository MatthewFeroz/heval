/** Public, bounded telemetry. Never include prompts, commands, paths or environment values. */
export const trialStates = ['running', 'passed', 'failed', 'error'] as const
export type TrialState = typeof trialStates[number]
export type LiveTrial = { id: string; state: TrialState; startedAt: number; updatedAt: number; finishedAt?: number }
export type RunMonitoring = {
  sequence: number
  sampledAt: number
  trials: LiveTrial[]
  events: { sequence: number; at: number; trial: string; state: TrialState }[]
}
export const MAX_MONITOR_TRIALS = 1000
export const MAX_MONITOR_EVENTS = 200
export function monitoringCounts(trials: LiveTrial[], total: number) {
  const count = (state: TrialState) => trials.filter(t => t.state === state).length
  const passed = count('passed'), failed = count('failed'), errors = count('error'), running = count('running')
  return { total, passed, failed, errors, running, finished: passed + failed + errors, pending: Math.max(0, total - trials.length) }
}
export function validateMonitoring(value: RunMonitoring, total: number) {
  const time = (n: number) => Number.isSafeInteger(n) && n >= 0
  if (!time(value.sequence) || value.sequence < 1 || !time(value.sampledAt) || value.trials.length > Math.min(MAX_MONITOR_TRIALS, total) || value.events.length > MAX_MONITOR_EVENTS) throw new Error('Invalid monitoring bounds.')
  const ids = new Set<string>()
  for (const trial of value.trials) {
    if (!/^[a-zA-Z0-9_-]{1,140}$/.test(trial.id) || ids.has(trial.id) || !trialStates.includes(trial.state) || !time(trial.startedAt) || !time(trial.updatedAt) || trial.updatedAt < trial.startedAt || (trial.finishedAt !== undefined && (!time(trial.finishedAt) || trial.finishedAt < trial.startedAt)) || (trial.state === 'running') !== (trial.finishedAt === undefined)) throw new Error('Invalid monitoring trial.')
    ids.add(trial.id)
  }
  let last = 0
  for (const event of value.events) {
    if (!time(event.sequence) || event.sequence <= last || !time(event.at) || !ids.has(event.trial) || !trialStates.includes(event.state)) throw new Error('Invalid monitoring event.')
    last = event.sequence
  }
}
