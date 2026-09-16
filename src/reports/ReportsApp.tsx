import { useState, useSyncExternalStore } from 'react'
import { useConvexAuth, useMutation, useQuery, useConvexConnectionState } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { useAppAuth } from '../auth'
import { ProjectReportView } from './ProjectReportView'
import { TeamAccess, AcceptInvitation } from './TeamAccess'
import { message, token } from './helpers'
import { MAX_IMPORT_BYTES, parseReport, type ReportData } from './format'

function subscribeHashChange(listener: () => void) { window.addEventListener('hashchange', listener); return () => window.removeEventListener('hashchange', listener) }

function SharedReport() {
  const shareToken = useSyncExternalStore(subscribeHashChange, () => location.hash.slice(1))
  const report = useQuery(api.reports.shared, { token: shareToken })
  const connection = useConvexConnectionState()
  if (!connection.isWebSocketConnected) return <section className="report-card"><h1>Checking report access…</h1><p>Connect to the internet to view this shared report.</p></section>
  if (report === undefined) return <p role="status">Loading shared report…</p>
  if (!report) return <section className="report-card"><h1>This link is unavailable</h1><p>It may have been revoked, or the link is incorrect. Ask the report owner for a new link.</p><a href="/reports">Go to Heval reports</a></section>
  return <><p className="report-notice">Shared report · Read only · No sign-in required · Published version {report.version}</p><ProjectReportView data={report.data} project={report.project} /></>
}

function SavedReport({ id }: { id: Id<'reports'> }) {
  const report = useQuery(api.reports.get, { id })
  const share = useMutation(api.reports.share)
  const revoke = useMutation(api.reports.revoke)
  const publish = useMutation(api.reportProjects.publish)
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
  return <><a href="/reports">← Your reports</a>
    <section className="report-card" aria-label="Saved draft"><span className="report-badge">{report.role} access</span><h2>Saved draft · Version {report.version}</h2>
      <p>{report.publishedVersion === null ? 'No published version yet. Creating your first share link publishes this saved draft.' : `Published version ${report.publishedVersion}${report.version === report.publishedVersion ? ' matches this draft.' : ' stays visible until the owner publishes these changes.'}`}</p>
      <div className="report-actions">{report.role !== 'viewer' && <a className="report-button" href={`/studio?report=${id}`}>Edit chart in Studio</a>}
        {report.role === 'owner' && report.publishedVersion !== null && <button disabled={busy || report.version === report.publishedVersion} onClick={() => void act(() => publish({ id, expectedVersion: report.version }), 'Saved draft published. Shared viewers now see this version.')}>Publish saved draft</button>}
      </div>
      {report.role === 'viewer' && <p>You can view this draft. Ask the owner for editor access to change it.</p>}
      {status && <p role="status">{status}</p>}{error && <p role="alert">{error}</p>}
    </section>
    <ProjectReportView data={report.data} project={report.project} />
    {report.role === 'owner' && <><section className="report-card report-sharing" aria-label="Sharing controls">
    <div><span className="report-badge">{shareUrl ? 'Anyone with the link' : 'Public link off'}</span><h2>{shareUrl ? 'Your report is ready to share' : 'Saved to your workspace'}</h2><p>{shareUrl ? 'Recipients can view the full report without an account. Revoking stops future access; it cannot erase copies someone already saved.' : 'Your report is saved online. Create a link to share the published version. Invited teammates retain their access when the public link is off.'}</p></div>
    {shareUrl ? <><label>Share link<input readOnly value={shareUrl} onFocus={event => event.target.select()} /></label><div className="report-actions"><button disabled={busy} onClick={() => void act(() => navigator.clipboard.writeText(shareUrl), 'Link copied.')}>Copy link</button><a href={shareUrl} target="_blank" rel="noreferrer">Open shared view ↗</a><button className="secondary" disabled={busy} onClick={() => setConfirmRevoke(true)}>Revoke link</button></div>
      {confirmRevoke && <div className="report-confirm" role="group" aria-label="Confirm revocation"><p>Turn off this public link? Your saved report and invited teammates keep their access.</p><button disabled={busy} onClick={() => void act(() => revoke({ id }), 'Link revoked. Your report is still saved.')}>Yes, revoke link</button><button className="secondary" disabled={busy} onClick={() => setConfirmRevoke(false)}>Keep sharing</button></div>}</>
      : <button disabled={busy} onClick={() => void act(() => share({ id, token: token() }), 'Share link created.')}>{busy ? 'Creating link…' : 'Create share link'}</button>}
  </section><TeamAccess id={id} /></>}</>
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
    </section><section className="report-card"><h2>Your saved reports</h2>{reports === undefined ? <p role="status">Loading reports…</p> : reports.length ? <ul className="report-list">{reports.map(r => <li key={r.id}><a href={`/reports?id=${r.id}`}><strong>{r.title}</strong><span>{r.trials} trials · {new Date(r.createdAt).toLocaleDateString()} · {r.role} · {r.shared ? 'Link enabled' : 'Public link off'}</span></a></li>)}</ul> : <p>No reports yet. Import your first result above; it stays here when you come back.</p>}</section></>
}

export function ReportsApp() {
  const auth = useAppAuth()
  const { isLoading, isAuthenticated } = useConvexAuth()
  const isShared = location.pathname === '/share'
  const hash = useSyncExternalStore(subscribeHashChange, () => location.hash)
  const invitation = hash.startsWith('#invite=') ? hash.slice(8) : null
  const id = new URLSearchParams(location.search).get('id')
  return <div className="report-shell"><header className="report-header"><a href="/" className="report-logo">heval<span> / reports</span></a><nav><a href="/reports">Your reports</a><a href="/studio">Studio</a>{!isShared && auth.user && <button className="secondary" onClick={auth.signOut}>Sign out</button>}</nav></header><main>
    {isShared ? <SharedReport /> : isLoading ? <p role="status">Connecting your workspace…</p> : !isAuthenticated ? <section className="report-card"><span className="report-eyebrow">IMPORT → SAVE → SHARE</span><h1>Your evaluations, ready to share.</h1><p>Sign in to save reports privately and manage who can open them.</p>{auth.configured ? <button onClick={auth.signIn}>Sign in to your workspace</button> : <p>Sign-in isn’t configured on this deployment yet.</p>}{auth.user && <p role="alert">Your account hasn’t connected to report storage. Try signing out and back in.</p>}</section> : invitation ? <AcceptInvitation token={invitation} /> : id ? <SavedReport id={id as Id<'reports'>} /> : <Workspace />}
  </main><footer className="report-footer">Heval reports · Imported evidence, with sharing you control.</footer></div>
}
