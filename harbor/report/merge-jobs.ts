/** Combine completed Harbor jobs or normalized exports without losing source identity. */
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import type { JobExport, TrialRow } from '../../src/charts/trial'
import { exportJob } from './trials'

export function mergeJobs(jobs: JobExport[], name: string): JobExport {
  if (!jobs.length) throw new Error('At least one job is required')
  const seen = new Set<string>()
  const rows: TrialRow[] = []
  const agentVersions: Record<string, string[]> = {}
  for (const job of jobs) {
    if (job.schemaVersion !== 1 || !Array.isArray(job.rows)) throw new Error('Expected a schemaVersion 1 Harbor export')
    for (const original of job.rows) {
      const row = { ...original, source: original.source ?? job.source, run: original.run ?? job.jobId ?? job.job }
      // Trial names can collide across jobs. Within a source, never count one twice.
      const key = row.trialId
        ? JSON.stringify(['id', row.trialId])
        : JSON.stringify(['name', row.run, row.source, row.trial])
      if (seen.has(key)) throw new Error(`Duplicate trial: ${row.run}/${row.trial}`)
      seen.add(key)
      rows.push(row)
      if (row.agentVersion) {
        agentVersions[row.agent] = [...new Set([...(agentVersions[row.agent] ?? []), row.agentVersion])].sort()
      }
    }
  }
  return {
    schemaVersion: 1, job: name, jobId: null, generatedAt: new Date().toISOString(),
    source: 'combined', agentVersions, rows,
    // Preserve source-level extensions/manifests as well as normalized rows.
    sources: jobs.map(job => {
      const metadata: Partial<JobExport> = { ...job }
      delete metadata.rows
      return metadata as Omit<JobExport, 'rows'>
    }),
  }
}

if (import.meta.main) {
  const [output, ...inputs] = process.argv.slice(2)
  if (!output || !inputs.length || !output.endsWith('.json')) {
    throw new Error('usage: bun harbor/report/merge-jobs.ts <output.json> <job-dir|export.json> [...]')
  }
  if (inputs.some(input => resolve(input) === resolve(output))) throw new Error('Output must differ from inputs')
  const jobs = inputs.map(input => statSync(input).isDirectory()
    // A combined report must not silently drop trials that never finished.
    ? exportJob(input, undefined, { requireComplete: true })
    : JSON.parse(readFileSync(input, 'utf8')) as JobExport)
  const result = mergeJobs(jobs, basename(output, '.json'))
  mkdirSync(dirname(resolve(output)), { recursive: true })
  writeFileSync(output, JSON.stringify(result, null, 2) + '\n')
  console.log(`${result.rows.length} trials from ${jobs.length} jobs -> ${output}`)
  console.log('Source identity and settings are preserved; comparability is not asserted.')
}
