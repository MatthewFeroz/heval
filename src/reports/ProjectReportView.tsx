import { useEffect, useMemo, useState } from 'react'
import { buildChart } from '../charts/recipes'
import { useChartPreview } from '../studio/useChartPreview'
import { renderReportProject } from './project'
import type { ReportData } from './format'

type Rendered = Awaited<ReturnType<typeof renderReportProject>>

/** Keyed by the saved document so an obsolete render never appears as the new revision. */
export function ProjectReportView({ data, project }: { data: string; project: string }) {
  return <LoadReport key={project} data={data} project={project} />
}
function LoadReport({ data, project }: { data: string; project: string }) {
  const [rendered, setRendered] = useState<Rendered | null>(null)
  const [error, setError] = useState('')
  const document = useMemo(() => JSON.parse(project), [project])
  const results: ReportData = useMemo(() => JSON.parse(data), [data])
  useEffect(() => {
    let live = true
    void renderReportProject(results, document).then(value => { if (live) setRendered(value) }).catch(error => { if (live) setError(error.message) })
    return () => { live = false }
  }, [document, results])
  if (error) return <p role="alert">The saved chart could not be loaded: {error}</p>
  if (!rendered) return <p role="status">Loading saved chart…</p>
  return <ReportView title={document.project.label} data={results} rendered={rendered} />
}
function ReportView({ title, data, rendered }: { title: string; data: ReportData; rendered: Rendered }) {
  const [model, setModel] = useState('all')
  const models = [...new Set(rendered.rows.map(row => row.model))]
  const rows = useMemo(() => rendered.rows.filter(row => model === 'all' || row.model === model), [rendered, model])
  const chart = useMemo(() => model === 'all' ? rendered.output : buildChart(rows, rendered.state, rendered.fields), [rendered, rows, model])
  const { host, error } = useChartPreview(rows.length ? chart.spec : null)
  const passed = rows.filter(row => row.passed).length
  return <section className="report-card" aria-label="Report results">
    <div className="report-eyebrow">SAVED EVALUATION · {new Date(data.generatedAt).toLocaleDateString()}</div>
    <h1>{title}</h1><p>Imported results from <strong>{data.job}</strong>. This report does not run an evaluation.</p>
    <p className="report-muted">{rendered.presentation ? 'Presentation' : 'Analysis view'}: {rendered.label}{rendered.filters.some(f => f.values.length) ? ' · Saved filters applied' : ''}</p>
    <div className="report-stats"><div><strong>{rows.length}</strong><span>Trials shown</span></div><div><strong>{passed} / {rows.length}</strong><span>Completed</span></div><div><strong>{new Set(rows.map(r => r.task)).size}</strong><span>Tasks</span></div></div>
    <label>Model <select aria-label="Model" value={model} onChange={event => setModel(event.target.value)}><option value="all">All models in this view</option>{models.map(m => <option key={m}>{m}</option>)}</select></label>
    {model !== 'all' && <p className="report-muted">Temporary filter for this visit. The saved chart is unchanged.</p>}
    <p className="report-muted">Rates describe these imported trials only. A small setup check is not a full benchmark score.</p>
    {!rows.length && <p>No trials match this view. Change the filters in Studio.</p>}
    {error && <p role="alert">Chart unavailable. Trial results are shown below.</p>}
    <div className="report-chart" data-theme={rendered.state.theme} ref={host} />
    <details><summary>Inspect {rows.length} trial results</summary><div className="report-table"><table><thead><tr><th>Task</th><th>Agent</th><th>Model</th><th>Result</th><th>Agent time</th></tr></thead><tbody>{rows.map(row => <tr key={row.trial}><td>{row.task}</td><td>{row.agent}</td><td>{row.model}</td><td>{row.passed ? 'Passed' : row.timedOut ? 'Timed out' : 'Not passed'}</td><td>{row.agentSeconds === null ? 'Unknown' : `${row.agentSeconds.toFixed(1)}s`}</td></tr>)}</tbody></table></div></details>
  </section>
}
