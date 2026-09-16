import { useMemo, useState, useSyncExternalStore } from 'react'
import { useConvexAuth, useMutation, useQuery, useConvexConnectionState } from 'convex/react'
import { ConvexError } from 'convex/values'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { useAppAuth } from '../auth'
import { buildChart, DEFAULT_STATE } from '../charts/recipes'
import { useChartPreview } from '../studio/useChartPreview'
import { MAX_IMPORT_BYTES, parseReport, type ReportData } from './format'

function message(error: unknown) {
  if (error instanceof ConvexError && typeof error.data === 'string') return error.data
  return error instanceof Error ? error.message.replace(/^.*Uncaught ConvexError: /s, '').split('\n')[0] : 'Something went wrong. Please retry.'
}
function token() { return Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('') }
function subscribeHashChange(listener: () => void) { window.addEventListener('hashchange', listener); return () => window.removeEventListener('hashchange', listener) }

function ReportView({ title, data }: { title: string; data: ReportData }) {
  const [model, setModel] = useState('all')
  const models = [...new Set(data.rows.map(row => row.model))]
  const rows = useMemo(() => data.rows.filter(row => model === 'all' || row.model === model), [data, model])
  const chart = useMemo(() => buildChart(rows, { ...DEFAULT_STATE, x: 'stack', color: 'none', theme: 'light', title: 'Completion by agent and model' }), [rows])
  const { host, error } = useChartPreview(chart.spec)
  const passed = rows.filter(row => row.passed).length
  return <section className="report-card" aria-label="Report results">
    <div className="report-eyebrow">SAVED EVALUATION · {new Date(data.generatedAt).toLocaleDateString()}</div>
    <h1>{title}</h1><p>Imported results from <strong>{data.job}</strong>. This report does not run an evaluation.</p>
    <div className="report-stats"><div><strong>{rows.length}</strong><span>Trials shown</span></div><div><strong>{passed} / {rows.length}</strong><span>Completed</span></div><div><strong>{new Set(rows.map(r => r.task)).size}</strong><span>Tasks</span></div></div>
    <label>Model <select aria-label="Model" value={model} onChange={event => setModel(event.target.value)}><option value="all">All models</option>{models.map(m => <option key={m}>{m}</option>)}</select></label>
    <p className="report-muted">Rates describe these imported trials only. A small setup check is not a full benchmark score.</p>
    {error ? <p role="alert">Chart unavailable. Trial results are shown below.</p> : <div className="report-chart" ref={host} />}
    <details><summary>Inspect {rows.length} trial results</summary><div className="report-table"><table><thead><tr><th>Task</th><th>Agent</th><th>Model</th><th>Result</th><th>Agent time</th></tr></thead><tbody>{rows.map(row => <tr key={row.trial}><td>{row.task}</td><td>{row.agent}</td><td>{row.model}</td><td>{row.passed ? 'Passed' : row.timedOut ? 'Timed out' : 'Not passed'}</td><td>{row.agentSeconds === null ? 'Unknown' : `${row.agentSeconds.toFixed(1)}s`}</td></tr>)}</tbody></table></div></details>
  </section>
}

function SharedReport() {
  const shareToken = useSyncExternalStore(subscribeHashChange, () => location.hash.slice(1))
  const report = useQuery(api.reports.shared, { token: shareToken })
  const connection = useConvexConnectionState()
  if (!connection.isWebSocketConnected) return <section className="report-card"><h1>Checking report access…</h1><p>Connect to the internet to view this shared report.</p></section>
  if (report === undefined) return <p role="status">Loading shared report…</p>
  if (!report) return <section className="report-card"><h1>This link is unavailable</h1><p>It may have been revoked, or the link is incorrect. Ask the report owner for a new link.</p><a href="/reports">Go to Heval reports</a></section>
  return <><p className="report-notice">Shared report · Read only · No sign-in required</p><ReportView title={report.title} data={JSON.parse(report.data)} /></>
}

function SavedReport({ id }: { id: Id<'reports'> }) {
  const report = useQuery(api.reports.get, { id })
  const share = useMutation(api.reports.share)
  const revoke = useMutation(api.reports.revoke)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [confirmRevoke, setConfirmRevoke] = useState(false)
  async function act(run: () => Promise<unknown>, success: string) {
    setBusy(true); setError(''); setStatus('')
    try { await run(); setStatus(success); setConfirmRevoke(false) } catch (error) { setError(message(error)) } finally { setBusy(false) }
  }
  if (report === undefined) return <p role="status">Loading your report…</p>
  if (!report) return <section className="report-card"><h1>Report not found</h1><p>This report is unavailable to your account.</p><a href="/reports">Your reports</a></section>
  const shareUrl = report.shareToken ? `${location.origin}/share#${report.shareToken}` : ''
  return <><a href="/reports">← Your reports</a><section className="report-card report-sharing" aria-label="Sharing controls">
    <div><span className="report-badge">{shareUrl ? 'Anyone with the link' : 'Private · Only you'}</span><h2>{shareUrl ? 'Your report is ready to share' : 'Saved to your workspace'}</h2><p>{shareUrl ? 'Recipients can view the full report without an account. Revoking stops future access; it cannot erase copies someone already saved.' : 'Your report is saved online. Create a link when you’re ready for someone else to see it.'}</p></div>
    {shareUrl ? <><label>Share link<input readOnly value={shareUrl} onFocus={event => event.target.select()} /></label><div className="report-actions"><button disabled={busy} onClick={() => void act(() => navigator.clipboard.writeText(shareUrl), 'Link copied.')}>Copy link</button><a href={shareUrl} target="_blank" rel="noreferrer">Open shared view ↗</a><button className="secondary" disabled={busy} onClick={() => setConfirmRevoke(true)}>Revoke link</button></div>
      {confirmRevoke && <div className="report-confirm" role="group" aria-label="Confirm revocation"><p>Turn off this link? Your saved report stays private in your workspace.</p><button disabled={busy} onClick={() => void act(() => revoke({ id }), 'Link revoked. Your report is still saved.')}>Yes, revoke link</button><button className="secondary" disabled={busy} onClick={() => setConfirmRevoke(false)}>Keep sharing</button></div>}</>
      : <button disabled={busy} onClick={() => void act(() => share({ id, token: token() }), 'Share link created.')}>{busy ? 'Creating link…' : 'Create share link'}</button>}
    {status && <p role="status">{status}</p>}{error && <p role="alert">{error}</p>}
  </section><ReportView title={report.title} data={JSON.parse(report.data)} /></>
}

function Workspace() {
  const reports = useQuery(api.reports.list)
  const save = useMutation(api.reports.save)
  const [draft, setDraft] = useState<ReportData | null>(null)
  const [title, setTitle] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function choose(file: File | undefined) {
    if (!file) return
    setError(''); setDraft(null)
    try {
      if (file.size > MAX_IMPORT_BYTES) throw new Error('Use a JSON export smaller than 750 KB.')
      const next = parseReport(await file.text()); setDraft(next); setTitle(next.job.slice(0, 120))
    } catch (error) { setError(message(error)) }
  }
  async function saveReport() {
    if (!draft) return
    setBusy(true); setError('')
    try { const id = await save({ json: JSON.stringify(draft), title }); location.assign(`/reports?id=${encodeURIComponent(id)}`) }
    catch (error) { setError(message(error)); setBusy(false) }
  }
  return <><div className="report-intro"><span className="report-eyebrow">YOUR WORKSPACE</span><h1>From local results to a shared report.</h1><p>Import an evaluation, save it privately, then share it on your terms.</p><ol className="report-steps"><li>Import</li><li>Save report</li><li>Share</li><li>Revoke anytime</li></ol></div>
    <section className="report-card"><h2>Import evaluation results</h2><p>Choose a normalized Harbor JSON export. Up to 500 trials, 750 KB.</p><label className="report-file">Choose Harbor JSON<input aria-label="Choose Harbor JSON" type="file" accept=".json,application/json" disabled={busy} onChange={event => void choose(event.target.files?.[0])} /></label>
      <details><summary>Where do I get this file?</summary><p>Use the normalized <code>results/harbor/&lt;job&gt;.json</code> generated by Heval’s Harbor report exporter. This first release accepts schemaVersion 1 exports with a rows array. Studio bundles and raw Harbor result.json files aren’t supported here yet.</p><p>Run <code>bun run report path/to/harbor-job</code> in a Heval checkout to create the export. You can inspect it locally with <code>npx @mattferoz/heval open path/to/export.json</code>.</p></details>
      {draft && <div className="report-import-preview"><h3>Review before saving</h3><p>{draft.rows.length} trials · {new Set(draft.rows.map(row => row.model)).size} models · {new Set(draft.rows.map(row => row.task)).size} tasks</p><label>Report title<input maxLength={120} value={title} onChange={event => setTitle(event.target.value)} /></label><p>Only trial labels, outcomes, timings, token counts, costs, and provenance fields shown in the export are saved. Raw configuration, local paths, error text, logs, and unknown fields are excluded. Check labels for sensitive information before sharing.</p><details><summary>Review exact saved data</summary><pre>{JSON.stringify(draft, null, 2)}</pre></details><button disabled={busy || !title.trim()} onClick={() => void saveReport()}>{busy ? 'Saving report…' : 'Save private report'}</button><button className="secondary" disabled={busy} onClick={() => setDraft(null)}>Cancel</button></div>}
      {error && <p role="alert">{error}</p>}
    </section><section className="report-card"><h2>Your saved reports</h2>{reports === undefined ? <p role="status">Loading reports…</p> : reports.length ? <ul className="report-list">{reports.map(r => <li key={r.id}><a href={`/reports?id=${r.id}`}><strong>{r.title}</strong><span>{r.trials} trials · {new Date(r.createdAt).toLocaleDateString()} · {r.shared ? 'Link enabled' : 'Private'}</span></a></li>)}</ul> : <p>No reports yet. Import your first result above; it stays here when you come back.</p>}</section></>
}

export function ReportsApp() {
  const auth = useAppAuth()
  const { isLoading, isAuthenticated } = useConvexAuth()
  const isShared = location.pathname === '/share'
  const id = new URLSearchParams(location.search).get('id')
  return <div className="report-shell"><header className="report-header"><a href="/" className="report-logo">heval<span> / reports</span></a><nav><a href="/reports">Your reports</a><a href="/studio">Studio</a>{!isShared && auth.user && <button className="secondary" onClick={auth.signOut}>Sign out</button>}</nav></header><main>
    {isShared ? <SharedReport /> : isLoading ? <p role="status">Connecting your workspace…</p> : !isAuthenticated ? <section className="report-card"><span className="report-eyebrow">IMPORT → SAVE → SHARE</span><h1>Your evaluations, ready to share.</h1><p>Sign in to save reports privately and manage who can open them.</p>{auth.configured ? <button onClick={auth.signIn}>Sign in to your workspace</button> : <p>Sign-in isn’t configured on this deployment yet.</p>}{auth.user && <p role="alert">Your account hasn’t connected to report storage. Try signing out and back in.</p>}</section> : id ? <SavedReport id={id as Id<'reports'>} /> : <Workspace />}
  </main><footer className="report-footer">Heval reports · Imported evidence, with sharing you control.</footer></div>
}
