import { validateComparison, type ComparisonGoal } from './comparison'
import { BENCHMARKS } from './benchmarks'

export type ManagedSpec = { goal: Exclude<ComparisonGoal, 'custom'>; harnesses: string[]; models: string[]; budgetUsd: number; minutes: number }
export type ManagedPolicy = { snapshot: string; benchmark: 'tblite-smoke'; taskSet: string; tasks: number; models: string[]; harnesses: string[]; maxBudgetUsd: number; maxMinutes: number }

/** An operator explicitly approves one task snapshot and its tested worker image. */
export function parseManagedPolicy(json: string): ManagedPolicy {
  const p = JSON.parse(json) as ManagedPolicy
  const benchmark = BENCHMARKS.find(b => b.id === 'tblite-smoke')!
  if (!p || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(p.snapshot) || p.benchmark !== 'tblite-smoke' || p.taskSet !== benchmark.taskSet || p.tasks !== benchmark.tasks) throw new Error('Approve a versioned snapshot with the pinned five-task benchmark.')
  if (!Array.isArray(p.harnesses) || p.harnesses.length !== 2 || new Set(p.harnesses).size !== 2 || p.harnesses.some(h => !['codex', 'pi', 'claude-code'].includes(h))) throw new Error('Approve two supported managed harnesses.')
  if (!Array.isArray(p.models) || p.models.length < 1 || p.models.length > 2 || new Set(p.models).size !== p.models.length || p.models.some(m => typeof m !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,159}$/.test(m))) throw new Error('Approve one or two exact model IDs.')
  if (!Number.isFinite(p.maxBudgetUsd) || p.maxBudgetUsd < 0.1 || p.maxBudgetUsd > 25 || !Number.isSafeInteger(p.maxMinutes) || p.maxMinutes < 10 || p.maxMinutes > 60) throw new Error('Managed beta limits are $0.10–$25 and 10–60 minutes.')
  return p
}

export function validateManagedSpec(p: ManagedPolicy, spec: ManagedSpec) {
  if (spec.goal !== 'harnesses' && spec.goal !== 'models') throw new Error('Choose a harness or model comparison.')
  if (!Array.isArray(spec.harnesses) || !Array.isArray(spec.models) || spec.harnesses.some(h => !p.harnesses.includes(h)) || spec.models.some(m => !p.models.includes(m)) || new Set(spec.harnesses).size !== spec.harnesses.length || new Set(spec.models).size !== spec.models.length) throw new Error('Choose approved harnesses and models.')
  validateComparison(spec.goal, spec.harnesses.flatMap(agent => spec.models.map(model => ({ agent, model, vendor: 'Provider default', taskSet: p.taskSet, tasks: p.tasks }))))
  if (!Number.isFinite(spec.budgetUsd) || Math.abs(spec.budgetUsd * 100 - Math.round(spec.budgetUsd * 100)) > 1e-8 || spec.budgetUsd < 0.1 || spec.budgetUsd > p.maxBudgetUsd || !Number.isSafeInteger(spec.minutes) || spec.minutes < 10 || spec.minutes > p.maxMinutes) throw new Error('Choose a model spending limit and deadline within the hosted beta limits.')
}
