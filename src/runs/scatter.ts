import type { RunTrial } from './database'

export type ScatterMode = 'log' | 'linear'
export type MeasuredTrial = RunTrial & { agentSeconds: number; costUsd: number }

/** Missing measurements never become zero. Log axes also exclude genuine zeros. */
export function scatterTrials(trials: RunTrial[], mode: ScatterMode): MeasuredTrial[] {
  const measured = (value: number | null): value is number => value !== null && Number.isFinite(value) && (mode === 'log' ? value > 0 : value >= 0)
  return trials.filter((trial): trial is MeasuredTrial => measured(trial.agentSeconds) && measured(trial.costUsd))
}

export function scatterAxis(values: number[], mode: ScatterMode) {
  const valid = values.filter(value => Number.isFinite(value) && (mode === 'log' ? value > 0 : value >= 0))
  const low = valid.length ? Math.min(...valid) : 1
  const high = valid.length ? Math.max(...valid) : 1
  const transform = mode === 'log' ? Math.log10 : (value: number) => value
  const min = mode === 'log' ? transform(low * .75) : 0
  const max = mode === 'log' ? transform(high * 1.35) : high * 1.1 || 1
  return {
    min: mode === 'log' ? 10 ** min : min,
    max: mode === 'log' ? 10 ** max : max,
    position: (value: number) => (transform(value) - min) / (max - min),
  }
}

/** Separate coordinate medians, not an observed trial or a pass-rate estimate. */
export function scatterMedian(trials: MeasuredTrial[]) {
  const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b)
    const middle = Math.floor(sorted.length / 2)
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
  }
  return trials.length ? { seconds: median(trials.map(trial => trial.agentSeconds)), cost: median(trials.map(trial => trial.costUsd)) } : null
}
