import { useState } from 'react'
import { useQuery } from 'convex/react'
import { api } from '../../convex/_generated/api'
import { PageHeader } from './PageHeader'
import { ImportResults } from './ImportResults'
import { libraryItems } from './libraryItems'

export function Library() {
  const reports = useQuery(api.reports.list), experiments = useQuery(api.experiments.list), jobs = useQuery(api.managedComparisons.list), baselines = useQuery(api.baselines.list), runs = useQuery(api.runners.runs)
  const [search, setSearch] = useState(''), [filter, setFilter] = useState('all')
  const [importing, setImporting] = useState(new URLSearchParams(location.search).has('import'))
  const loaded = reports !== undefined && experiments !== undefined && jobs !== undefined && baselines !== undefined && runs !== undefined
  const items = loaded ? libraryItems({ reports, experiments, jobs, baselines, runs }) : []
  const matching = items.filter(item => `${item.title} ${item.detail} ${item.status}`.toLowerCase().includes(search.toLowerCase()) && (filter === 'all' || filter === 'running' && item.active || filter === 'baselines' && item.baseline || filter === 'shared' && item.shared))
  return <>
    <PageHeader title="Library" actions={<><a className="report-button primary" href="/library?new=1">New comparison</a><button className="secondary" aria-expanded={importing} onClick={() => setImporting(!importing)}>Import results</button></>}>Run comparisons, import results and return to your saved work.</PageHeader>
    {importing && <ImportResults />}
    <section className="report-card" aria-label="Library items" data-tour="experiments">
      <div className="library-filters"><label>Search Library<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Name, execution or status" /></label><label>Show<select aria-label="Show" value={filter} onChange={event => setFilter(event.target.value)}><option value="all">All items</option><option value="running">Running</option><option value="baselines">Baselines</option><option value="shared">Shared publicly</option></select></label></div>
      {!loaded ? <p role="status">Loading your Library…</p> : !items.length ? <div className="evaluation-empty"><h2>Start your first comparison</h2><p>Compare harnesses or models on the same tasks, or import results you already have.</p><a className="report-button primary" href="/library?new=1">Create a comparison</a></div> : !matching.length ? <p>No items match these filters.</p> : <ul className="library-items">{matching.map(item => <li key={item.key}>
        <a className="library-item-main" href={item.href}><strong>{item.title}</strong><span>{item.detail}</span><small>{Number.isFinite(item.createdAt) ? new Date(item.createdAt).toLocaleDateString() : ''} · {item.status}{item.shared ? ' · Public link on' : ''}</small></a>
        <div className="library-item-actions">{item.baseline && <><span className="report-badge">Baseline</span><a href={`/library?new=1&baseline=${item.baseline.id}`}>Compare against baseline</a></>}</div>
      </li>)}</ul>}
    </section>
  </>
}
