import type { FunctionReturnType } from 'convex/server'
import type { api } from '../../convex/_generated/api'

type Queries = {
  reports: FunctionReturnType<typeof api.reports.list>
  experiments: FunctionReturnType<typeof api.experiments.list>
  jobs: FunctionReturnType<typeof api.managedComparisons.list>
  baselines: FunctionReturnType<typeof api.baselines.list>
  runs: FunctionReturnType<typeof api.runners.runs>
}
export type LibraryItem = {
  key: string; title: string; href: string; createdAt: number; kind: 'comparison' | 'report' | 'run'
  status: string; detail: string; active: boolean; shared: boolean
  baseline?: Queries['baselines'][number]
}
const managedTerminal = ['completed', 'failed', 'cancelled']
const runTerminal = ['completed', 'failed', 'cancelled', 'interrupted']

/** Join by persisted IDs, never titles. Child reports remain inside their comparison. */
export function libraryItems({ reports, experiments, jobs, baselines, runs }: Queries): LibraryItem[] {
  const items: LibraryItem[] = []
  const representedReports = new Set<string>()
  const byReport = new Map(reports.map(report => [report.id, report]))
  const byExperiment = new Map(experiments.map(experiment => [experiment.id, experiment]))
  const baselineFor = (experiment: string) => baselines.find(baseline => baseline.experiment === experiment)
  const setupRuns = new Set(experiments.flatMap(e => e.setupRun ? [e.setupRun] : []))
  const representedExperiments = new Set<string>()
  function hideReports(experiment: string, report?: string | null) {
    if (report) representedReports.add(report)
    const setupRun = experiments.find(item => item.id === experiment)?.setupRun
    for (const run of runs) if ((run.experiment === experiment || run.id === setupRun) && run.report) representedReports.add(run.report)
  }
  for (const job of jobs) {
    const experiment = job.experiment ? byExperiment.get(job.experiment) : undefined
    const report = experiment?.report ? byReport.get(experiment.report) : undefined
    if (job.experiment) { representedExperiments.add(job.experiment); hideReports(job.experiment, experiment?.report) }
    items.push({ key: `managed:${job.id}`, title: report?.title ?? job.title, href: `/library?managed=${job.id}`, createdAt: job.createdAt,
      kind: 'comparison', status: job.status, detail: `Managed cloud · ${job.message}`, active: !managedTerminal.includes(job.status), shared: report?.shared ?? false,
      baseline: job.experiment ? baselineFor(job.experiment) : undefined })
  }
  for (const experiment of experiments) {
    if (representedExperiments.has(experiment.id)) continue
    const report = experiment.report ? byReport.get(experiment.report) : undefined
    hideReports(experiment.id, experiment.report)
    items.push({ key: `experiment:${experiment.id}`, title: report?.title ?? experiment.title, href: `/library?experiment=${experiment.id}`, createdAt: experiment.createdAt,
      kind: 'comparison', status: experiment.finished < experiment.runs ? 'running' : experiment.failed ? 'needs attention' : 'finished',
      detail: `Connected worker · ${experiment.finished} / ${experiment.runs} runs finished`, active: experiment.finished < experiment.runs, shared: report?.shared ?? false, baseline: baselineFor(experiment.id) })
  }
  for (const run of runs) {
    if (run.experiment && (byExperiment.has(run.experiment) || representedExperiments.has(run.experiment)) || setupRuns.has(run.id)) continue
    const report = run.report ? byReport.get(run.report) : undefined
    if (run.report) representedReports.add(run.report)
    items.push({ key: `run:${run.id}`, title: report?.title ?? run.profile.title, href: `/library?run=${run.id}`, createdAt: run.createdAt,
      kind: 'run', status: run.status, detail: run.message || run.phase, active: !runTerminal.includes(run.status), shared: report?.shared ?? false })
  }
  for (const report of byReport.values()) {
    if (representedReports.has(report.id)) continue
    items.push({ key: `report:${report.id}`, title: report.title, href: `/library?report=${report.id}`, createdAt: report.createdAt,
      kind: 'report', status: 'saved', detail: `${report.trials} trials · ${report.role} access`, active: false, shared: report.shared,
      baseline: baselines.find(baseline => baseline.report === report.id) })
  }
  // Baseline snapshots remain discoverable if their original comparison has
  // fallen outside the bounded history queries.
  for (const baseline of baselines) if (!items.some(item => item.baseline?.id === baseline.id)) {
    const existing = items.find(item => item.key === `report:${baseline.report}`)
    if (existing) existing.baseline = baseline
    else items.push({ key: `baseline:${baseline.id}`, title: baseline.title, href: `/library?report=${baseline.report}`, createdAt: baseline.createdAt, kind: 'report', status: 'saved', detail: 'Saved baseline', active: false, shared: false, baseline })
  }
  return items.sort((a, b) => b.createdAt - a.createdAt || a.key.localeCompare(b.key))
}
