import type { TrialRow } from '../charts/trial'

export const outcome = (row: TrialRow) => row.error ? 'Execution error' : row.timedOut ? 'Timed out' : row.passed ? 'Passed' : 'Not passed'
export const taskIdentity = (row: TrialRow) => JSON.stringify([row.benchmark ?? '', row.dataset ?? '', row.taskFull || row.task])
export type TaskGroup = { id: string; title: string; rows: TrialRow[]; disagreement: boolean }
export function groupTasks(rows: TrialRow[]): TaskGroup[] {
  const groups = new Map<string, TaskGroup>()
  for (const row of rows) {
    const id = taskIdentity(row)
    const group = groups.get(id) ?? { id, title: row.taskFull || row.task, rows: [], disagreement: false }
    group.rows.push(row)
    groups.set(id, group)
  }
  return [...groups.values()].map(group => ({ ...group, disagreement: new Set(group.rows.map(outcome)).size > 1 })).sort((a, b) => Number(b.disagreement) - Number(a.disagreement) || a.title.localeCompare(b.title))
}
export function comparability(a: TrialRow, b: TrialRow): string | null {
  if (a.trial === b.trial) return 'Choose two different attempts to compare.'
  if (taskIdentity(a) !== taskIdentity(b)) return 'These attempts ran different tasks.'
  if (!a.taskChecksum || !b.taskChecksum) return 'Task content was not pinned for both attempts. Matching task content cannot be verified.'
  if (a.taskChecksum !== b.taskChecksum) return 'Task content differs between these attempts.'
  if ((a.benchmarkVersion ?? '') !== (b.benchmarkVersion ?? '') || (a.datasetVersion ?? '') !== (b.datasetVersion ?? '')) return 'Benchmark or dataset versions differ between these attempts.'
  return null
}
