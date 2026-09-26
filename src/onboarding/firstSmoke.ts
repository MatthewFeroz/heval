import { RUNNER_ONLINE_MS, type RunnerProfile, type RunStatus } from '../runners/protocol'

export const SMOKE_STEPS = ['install', 'connect', 'provider', 'run'] as const
export type SmokeStepId = typeof SMOKE_STEPS[number]
type Machine = { id: string; name: string; revoked: boolean; lastSeen: number; ready: boolean; health: string; profiles: RunnerProfile[]; enabled?: boolean }
type Run = { id: string; runner: string; profile: RunnerProfile; experiment: string | null; status: RunStatus; phase: string; message: string | null; report: string | null }
const runnable = (p: RunnerProfile) => !p.setupCheck && !!p.taskSet && !!p.vendor && p.maxAttempts !== undefined

/** Connection, provider and completion are observed facts; installation alone is a local acknowledgment. */
export function firstSmokeProgress<M extends Machine, R extends Run>({ machines, runs, now, installed = false, preferred = 'codex' }: { machines: M[]; runs: R[]; now: number; installed?: boolean; preferred?: string }) {
  const active = machines.filter(m => !m.revoked)
  const online = (m: Machine) => now - m.lastSeen < RUNNER_ONLINE_MS
  const harnessOf = (m: Machine) => m.profiles.some(p => runnable(p) && p.agent === preferred) ? preferred : m.profiles.find(runnable)?.agent
  const machine = [...active].sort((a,b) => Number(b.enabled !== false && online(b)) - Number(a.enabled !== false && online(a)) || Number(!!harnessOf(b)) - Number(!!harnessOf(a)))[0]
  const harness = (machine && harnessOf(machine)) ?? preferred
  const profile = machine?.profiles.filter(p => runnable(p) && p.agent === harness).sort((a,b) => a.tasks-b.tasks)[0]
  const checkProfile = machine?.profiles.find(p => p.setupCheck && p.agent === 'oracle')
  const smokeRun = runs.find(r => r.experiment && !r.profile.setupCheck && r.profile.agent === harness && r.runner === machine?.id)
  const done = { install: installed || !!machine, connect: !!machine, provider: !!profile, run: smokeRun?.status === 'completed' && !!smokeRun.report }
  return { done, current: SMOKE_STEPS.find(step => !done[step]) ?? null, machine, online: !!machine && online(machine), switchedOff: machine?.enabled === false, harness, profile, checkProfile, smokeRun }
}
