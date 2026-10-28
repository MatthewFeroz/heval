import { useMemo, useState, useSyncExternalStore } from 'react'
import type { TrialRow } from '../charts/trial'
import { comparability, groupTasks, outcome } from './taskComparison'
import { RunArtifact, type TrialArtifact } from './RunArtifact'
import './task-browser.css'

function subscribe(listener: () => void) { window.addEventListener('popstate', listener); window.addEventListener('openeval:task-selection', listener); return () => { window.removeEventListener('popstate', listener); window.removeEventListener('openeval:task-selection', listener) } }
type View = 'output' | 'patch' | 'verifier' | 'timeline'
const views: { id: View; label: string }[] = [{ id: 'output', label: 'Output' }, { id: 'patch', label: 'Patch' }, { id: 'verifier', label: 'Tests' }, { id: 'timeline', label: 'Timeline' }]
const attempt = (row: TrialRow) => `${row.modelShort || row.model} · ${row.agent} · ${row.trial}`

export function TaskBrowser({ rows, evidence = [] }: { rows: TrialRow[]; evidence?: TrialArtifact[] }) {
  const search = useSyncExternalStore(subscribe, () => location.search)
  const params = new URLSearchParams(search)
  const groups = useMemo(() => groupTasks(rows), [rows])
  const [query, setQuery] = useState(''), [filter, setFilter] = useState('all'), [copied, setCopied] = useState(false), [copyError, setCopyError] = useState('')
  const filtered = groups.filter(group => group.title.toLowerCase().includes(query.toLowerCase()) && (filter === 'all' || filter === 'differences' && group.disagreement || filter === 'failures' && group.rows.some(row => !row.passed || row.error) || filter === 'timeouts' && group.rows.some(row => row.timedOut)))
  const selected = filtered.find(group => group.rows.some(row => row.trial === params.get('task'))) ?? filtered[0]
  const left = selected?.rows.find(row => row.trial === params.get('left')) ?? selected?.rows[0]
  const right = selected?.rows.find(row => row.trial === params.get('right') && row.trial !== left?.trial) ?? selected?.rows.find(row => row.trial !== left?.trial)
  const view = views.find(item => item.id === params.get('evidence'))?.id ?? 'verifier'
  function update(values: Record<string, string | null>) {
    const url = new URL(location.href)
    for (const [name, value] of Object.entries(values)) { if (value === null) url.searchParams.delete(name); else url.searchParams.set(name, value) }
    history.pushState(null, '', url)
    window.dispatchEvent(new Event('openeval:task-selection'))
    setCopied(false); setCopyError('')
  }
  async function copyLink() {
    const url = new URL(location.href)
    for (const [key, value] of Object.entries({ task: selected!.rows[0].trial, left: left!.trial, right: right?.trial, evidence: view })) if (value) url.searchParams.set(key, value)
    try { await navigator.clipboard.writeText(url.href); setCopied(true); setCopyError('') } catch { setCopyError('Could not copy. Copy the comparison URL from your browser after selecting the attempts.') }
  }
  const note = left && right ? comparability(left, right) : null
  return <section className="report-card task-browser" aria-label="Task comparison">
    <div className="task-browser-heading"><div><span className="report-eyebrow">INSPECT THE ACTUAL ATTEMPTS</span><h2>Compare task results</h2><p>Inspect every recorded attempt, including failures and repeated runs.</p></div>{selected && <button type="button" onClick={() => void copyLink()}>{copied ? 'Comparison link copied' : 'Copy comparison link'}</button>}</div>
    <div className="task-browser-filters"><label>Find a task<input type="search" value={query} onChange={event => { setQuery(event.target.value); setCopied(false) }} placeholder="Task name" /></label><label>Show<select aria-label="Show tasks" value={filter} onChange={event => { setFilter(event.target.value); setCopied(false) }}><option value="all">All tasks</option><option value="differences">Different outcomes</option><option value="failures">Failures and errors</option><option value="timeouts">Timeouts</option></select></label></div>
    <p className="report-muted" role="status">{filtered.length} of {groups.length} tasks · All report trials, independent of chart filters</p>
    {copyError && <p role="alert">{copyError}</p>}
    {!selected ? <p>No tasks match these filters.</p> : <div className="task-browser-layout">
      <nav className="task-browser-list" aria-label="Tasks">{filtered.map(group => <button type="button" key={group.id} aria-current={selected.id === group.id ? 'true' : undefined} onClick={() => update({ task: group.rows[0].trial, left: null, right: null })}><strong>{group.title}</strong><span>{group.rows.filter(row => row.passed).length} / {group.rows.length} passed{group.disagreement ? ' · Different outcomes' : ''}</span></button>)}</nav>
      <div className="task-browser-detail"><h3>{selected.title}</h3>{note && <p className="report-notice" role="status">{note}</p>}{left && right && !note && <p className="report-muted">Same pinned task content. Model, harness and serving configuration are shown for each attempt.</p>}
        <div className="task-evidence-tabs" role="group" aria-label="Evidence view">{views.map(item => <button key={item.id} type="button" aria-pressed={view === item.id} onClick={() => update({ evidence: item.id })}>{item.label}</button>)}</div>
        <div className="task-comparison-panels">
          {left && <AttemptPanel side="Left" row={left} rows={selected.rows} evidence={evidence} view={view} onSelect={id => update({ task: selected.rows[0].trial, left: id, right: id === right?.trial ? left.trial : right?.trial ?? null })} />}
          {right ? <AttemptPanel side="Right" row={right} rows={selected.rows.filter(row => row.trial !== left?.trial)} evidence={evidence} view={view} onSelect={id => update({ task: selected.rows[0].trial, left: left!.trial, right: id })} /> : <div className="task-attempt-empty"><p>Only one attempt was recorded for this task. Another attempt is needed for a side-by-side comparison.</p></div>}
        </div>
      </div>
    </div>}
  </section>
}
function AttemptPanel({ side, row, rows, evidence, view, onSelect }: { side: string; row: TrialRow; rows: TrialRow[]; evidence: TrialArtifact[]; view: View; onSelect: (id: string) => void }) {
  const [artifactId, setArtifactId] = useState('')
  const artifacts = evidence.filter(item => item.trial === row.trial && (view === 'output' ? item.kind === 'html' || item.kind === 'image' : item.kind === view))
  const artifact = artifacts.find(item => item.id === artifactId) ?? artifacts[0]
  return <section className="task-attempt" aria-label={`${side} attempt`}>
    <label>{side} attempt<select aria-label={`${side} attempt`} value={row.trial} onChange={event => onSelect(event.target.value)}>{rows.map(item => <option key={item.trial} value={item.trial}>{attempt(item)}</option>)}</select></label>
    <h4>{row.model}</h4><p>{row.agent}{row.agentVersion ? ` ${row.agentVersion}` : ''} · {row.vendor ?? 'Serving vendor unknown'}</p>
    <dl className="task-attempt-metrics"><div><dt>Result</dt><dd>{outcome(row)}</dd></div><div><dt>Agent time</dt><dd>{row.agentSeconds === null ? 'Unknown' : `${row.agentSeconds.toFixed(1)}s`}</dd></div><div><dt>Cost</dt><dd>{row.costUsd === null ? 'Unknown' : `$${row.costUsd.toFixed(4)}`} {row.costSource && <small>{row.costSource}</small>}</dd></div><div><dt>Tokens</dt><dd>{row.totalTokens?.toLocaleString() ?? 'Unknown'}</dd></div></dl>
    <details className="task-attempt-identity"><summary>Attempt and task identity</summary><dl><dt>Trial</dt><dd>{row.trial}</dd><dt>Task checksum</dt><dd>{row.taskChecksum ?? 'Not recorded'}</dd><dt>Benchmark version</dt><dd>{row.benchmarkVersion ?? 'Not recorded'}</dd><dt>Dataset version</dt><dd>{row.datasetVersion ?? 'Not recorded'}</dd></dl></details>
    {row.error && <details><summary>Recorded error</summary><pre className="run-evidence-text">{row.error}</pre></details>}
    <div className="task-attempt-evidence">{artifact ? <article key={artifact.id}>{artifacts.length > 1 ? <label>Artifact<select aria-label={`${side} artifact`} value={artifact.id} onChange={event => setArtifactId(event.target.value)}>{artifacts.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label> : <h4>{artifact.title}</h4>}<p className="report-muted">{artifact.published ? 'Published evidence' : 'Private evidence'}</p><RunArtifact artifact={artifact} /></article> : <p className="report-muted">No {view === 'output' ? 'visual output' : view === 'verifier' ? 'verifier output' : view} was recorded or shared for this attempt.</p>}</div>
  </section>
}
