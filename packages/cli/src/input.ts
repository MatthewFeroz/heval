import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { exportJob } from '../../../harbor/report/trials'
import type { JobExport } from '../../../src/charts/trial'

const MAX_BYTES = 64 * 1024 * 1024

export function validateExport(value: unknown): JobExport {
  if (!value || typeof value !== 'object') throw new Error('Expected a Heval job export JSON object.')
  const job = value as Partial<JobExport>
  if (job.schemaVersion !== 1 || typeof job.job !== 'string' || !job.job.trim() || !Array.isArray(job.rows)) {
    throw new Error('Expected a normalized Heval job export (schemaVersion: 1, job, rows). Open project/bundle files with Studio’s “Open export” button.')
  }
  if (!job.rows.length) throw new Error('No completed trials found. Wait for a Harbor trial to finish, then open this job again.')
  for (const [index, row] of job.rows.entries()) {
    if (!row || typeof row !== 'object') throw new Error(`Trial ${index + 1} is not an object.`)
    for (const key of ['trial', 'task', 'taskFull', 'agent', 'model', 'modelShort', 'stack'] as const) {
      if (typeof row[key] !== 'string' || !row[key]) throw new Error(`Trial ${index + 1} is missing ${key}.`)
    }
    if (row.passed !== 0 && row.passed !== 1) throw new Error(`Trial ${index + 1} has an invalid passed value (expected 0 or 1).`)
    for (const key of ['reward', 'agentSeconds', 'totalSeconds', 'inputTokens', 'cacheTokens', 'outputTokens', 'totalTokens', 'costUsd'] as const) {
      if (row[key] !== null && row[key] !== undefined && (typeof row[key] !== 'number' || !Number.isFinite(row[key]))) {
        throw new Error(`Trial ${index + 1} has an invalid ${key}.`)
      }
    }
  }
  return {
    ...job,
    jobId: typeof job.jobId === 'string' ? job.jobId : null,
    generatedAt: typeof job.generatedAt === 'string' ? job.generatedAt : new Date().toISOString(),
    source: typeof job.source === 'string' ? job.source : '',
    agentVersions: job.agentVersions && typeof job.agentVersions === 'object' ? job.agentVersions : {},
  } as JobExport
}

export function loadInput(path: string): JobExport {
  const absolute = resolve(path)
  const stat = statSync(absolute)
  // Explicitly avoid applying a catalog from the caller's current directory.
  // Unreported costs stay unknown unless the original export supplied them.
  if (stat.isDirectory()) return validateExport(exportJob(absolute, null))
  if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error('Use a JSON file smaller than 64 MiB or a Harbor job directory.')
  let value: unknown
  try { value = JSON.parse(readFileSync(absolute, 'utf8')) }
  catch { throw new Error(`Could not parse JSON in ${absolute}.`) }
  return validateExport(value)
}
