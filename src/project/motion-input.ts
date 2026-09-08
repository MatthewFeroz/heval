import type { JobExport, TrialRow } from '../charts/trial'

/** The resolved presentation rows travel with both preview and export requests. */
export function motionInput(label: string, rows: readonly TrialRow[]): JobExport {
  return { schemaVersion: 1, job: label, jobId: null, generatedAt: '', source: 'presentation', agentVersions: {}, rows: [...rows] }
}

export function parseMotionInput(value: unknown): JobExport {
  if (!value || typeof value !== 'object') throw new Error('Expected presentation data')
  const input = value as JobExport
  if (input.schemaVersion !== 1 || typeof input.job !== 'string' || input.job.length > 500 || !Array.isArray(input.rows) || !input.rows.length || input.rows.length > 50000) throw new Error('Expected a label and 1–50000 presentation rows')
  for (const row of input.rows) {
    if (!row || typeof row !== 'object' || typeof row.modelShort !== 'string' || typeof row.trial !== 'string' || typeof row.task !== 'string' || (row.passed !== 0 && row.passed !== 1)) throw new Error('Invalid presentation row')
    for (const value of Object.values(row)) {
      if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) throw new Error('Presentation row values must be scalar')
      if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Presentation values must be finite')
    }
  }
  return motionInput(input.job, input.rows)
}
