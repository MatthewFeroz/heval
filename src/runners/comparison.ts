import type { RunnerProfile, RunSettings } from './protocol'

export type ComparisonGoal = 'harnesses' | 'models' | 'custom'
export const comparisonGoals: { id: ComparisonGoal; title: string; description: string }[] = [
  { id: 'harnesses', title: 'Compare harnesses', description: 'Two harnesses, one model and the same tasks. Review the serving route.' },
  { id: 'models', title: 'Compare models', description: 'Two models, one harness, the same tasks. Each serving vendor stays visible.' },
  { id: 'custom', title: 'Custom experiment', description: 'Choose your own harness and model combinations.' },
]

/** The server enforces the same conditions as the guided selection. */
export function validateComparison(goal: ComparisonGoal, profiles: Pick<RunnerProfile, 'agent' | 'model' | 'vendor' | 'taskSet' | 'tasks'>[]) {
  if (!profiles.length || profiles.some(p => !p.taskSet) || new Set(profiles.map(p => p.taskSet)).size !== 1 || new Set(profiles.map(p => p.tasks)).size !== 1) throw new Error('Use the same task snapshot and task count for every combination.')
  if (goal === 'custom') return
  const harnesses = new Set(profiles.map(p => p.agent)).size, models = new Set(profiles.map(p => p.model)).size
  if (goal === 'harnesses' && (profiles.length !== 2 || harnesses !== 2 || models !== 1 || new Set(profiles.map(p => p.vendor)).size !== 1)) throw new Error('A harness comparison needs two harnesses, one model and one serving vendor.')
  if (goal === 'models' && (profiles.length !== 2 || harnesses !== 1 || models !== 2)) throw new Error('A model comparison needs two models and one harness.')
}

export function sameSettings(a?: RunSettings | null, b?: RunSettings | null) {
  return ['concurrency', 'retries', 'cpus', 'memoryMb', 'timeoutSeconds'].every(key => a?.[key as keyof RunSettings] === b?.[key as keyof RunSettings])
}

export function profileIdentity(p: Pick<RunnerProfile, 'agent' | 'model' | 'vendor'>) {
  return JSON.stringify([p.agent, p.model, p.vendor ?? 'Provider default'])
}

/** Deterministic defaults use a complete pair, never a silently incomplete matrix. */
export function starterPair(profiles: RunnerProfile[], goal: ComparisonGoal): RunnerProfile[] {
  const ordered = [...profiles].sort((a, b) => a.tasks - b.tasks || a.id.localeCompare(b.id))
  for (const a of ordered) for (const b of ordered) {
    if (a.id === b.id || a.taskSet !== b.taskSet || a.tasks !== b.tasks) continue
    try { validateComparison(goal, [a, b]); return [a, b] } catch { /* Try the next complete pair. */ }
  }
  return []
}
