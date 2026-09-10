import { SLOW_TRIAL_SECONDS, type JobExport } from '../src/charts/trial'
import { RunnerError, type Run } from './types'

export function exportRuns(runs: Run[]): JobExport {
  if (!runs.length || runs.some(run => !run.grade && (run.status !== 'timed-out' || run.timeoutStage === 'grader'))) {
    throw new RunnerError('Only graded attempts and timed-out attempts can be charted. Inspect other failures in run history.', 409)
  }
  const ids = runs.map(run => run.id).sort()
  return {
    schemaVersion: 1, job: `evaluation-${ids.join('-')}`, jobId: ids.length === 1 ? ids[0] : null,
    generatedAt: runs.map(run => run.finishedAt || run.startedAt).sort().at(-1)!,
    source: 'Heval saved evaluations', agentVersions: {},
    rows: runs.map(run => {
      const seconds = (end?: string) => end ? Math.max(0, (Date.parse(end) - Date.parse(run.startedAt)) / 1000) : null
      const agentSeconds = seconds(run.agentFinishedAt)
      const modelShort = run.model.split('/').at(-1)!
      return {
        trial: run.id, task: run.task || 'concurrent-cache-v1', taskFull: run.task || 'concurrent-cache-v1',
        taskChecksum: run.taskChecksum ?? null, agent: run.harness, agentVersion: null,
        model: run.model, modelShort, provider: run.model.includes('/') ? run.model.split('/')[0] : null,
        vendor: null, stack: `${run.harness} / ${modelShort}`, reward: run.grade?.passed ? 1 : 0,
        passed: run.grade?.passed ? 1 : 0, agentSeconds, totalSeconds: seconds(run.finishedAt),
        overSlow: run.status === 'timed-out' || (agentSeconds !== null && agentSeconds > SLOW_TRIAL_SECONDS) ? 1 : 0,
        timedOut: run.status === 'timed-out' ? 1 : 0, inputTokens: null, cacheTokens: null, outputTokens: null,
        totalTokens: run.totalTokens ?? null, costUsd: run.costUsd ?? null, costSource: null,
        startedAt: run.startedAt, error: run.error ?? (run.grade?.passed === false ? 'Verifier failed' : null),
      }
    }),
  }
}
