import { lazy, Suspense, useState, type ReactNode } from 'react'
import { useMutation, useQuery } from 'convex/react'
import type { FunctionReturnType } from 'convex/server'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { ProjectReportView } from './ProjectReportView'
import { TrialEvidence } from './TrialEvidence'
import { TeamAccess } from './TeamAccess'
import { message, token } from './helpers'
import { reportSections, useReportSection } from './workspaceNavigation'

const HostedStudio = lazy(async () => ({ default: (await import('./HostedStudio')).HostedStudio }))
type Report = NonNullable<FunctionReturnType<typeof api.reports.get>>

/** One workspace for imported reports and the combined result of a comparison. */
export function ReportWorkspace({ id, results, context = 'report', title }: {
  id: Id<'reports'>; results?: ReactNode; context?: 'report' | 'evaluation'; title?: string
}) {
  const report = useQuery(api.reports.get, { id })
  const fileEditor = location.pathname === '/studio' || location.pathname === '/studio.html'
  const initialSection = fileEditor ? report && JSON.parse(report.project).mode === 'presentation' ? 'export' : 'analyze' : 'results'
  const { section, navigate } = useReportSection(initialSection)
  // Keep the editor mounted after its first visit, including when inspecting
  // results or sharing. Moving between sections must not discard an unsaved draft.
  const [editorVisited, setEditorVisited] = useState(section === 'analyze' || section === 'export')
  const [editorSection, setEditorSection] = useState<'analyze' | 'export'>(section === 'export' ? 'export' : 'analyze')
  const [editorDirty, setEditorDirty] = useState(false)
  if (report === undefined) return <p role="status">Loading your report…</p>
  if (!report) return <section className="report-card"><h1>Report not found</h1><p>This report is unavailable to your account.</p><a href="/library">Return to Library</a></section>
  const editing = section === 'analyze' || section === 'export'
  return <div className="report-workspace">
    <div className="report-intro"><a href="/library">← Library</a><h1>{title ?? report.title}</h1><p><span className="report-badge">{report.role} access</span> · Draft {report.version}{report.publishedVersion !== null ? ` · Published ${report.publishedVersion}` : ' · Private'}</p></div>
    <nav className="report-workspace-tabs" aria-label="Report workspace">{reportSections.map(tab => {
      const url = new URL(location.href)
      url.searchParams.set('tab', tab.id)
      return <a key={tab.id} href={url.pathname + url.search} aria-current={section === tab.id ? 'page' : undefined} onClick={event => {
        if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        event.preventDefault()
        if (tab.id === 'analyze' || tab.id === 'export') { setEditorVisited(true); setEditorSection(tab.id) }
        navigate(tab.id)
      }}>{tab.label}</a>
    })}</nav>
    <div className="report-workspace-results" hidden={section !== 'results'}>
      {results}
      <ProjectReportView data={report.data} project={report.project} context={context} showTitle={false} evidence={report.evidence} />
      {report.role === 'owner' && <TrialEvidence evidence={report.evidence} report={id} data={report.data} owner />}
    </div>
    {report.role !== 'viewer' && (editorVisited || editing) && <div className="report-editor" hidden={!editing}>
      <Suspense fallback={<p role="status">Opening chart editor…</p>}><HostedStudio id={id} workspaceSection={editing ? section : editorSection} onDirtyChange={setEditorDirty} /></Suspense>
    </div>}
    {editing && report.role === 'viewer' && <section className="report-card"><h2>View access</h2><p>You can inspect the saved analysis in Results. Ask the owner for editor access to change charts or create presentations.</p></section>}
    {section === 'export' && <DataExport report={report} />}
    {section === 'share' && <>{editorDirty && report.role !== 'viewer' && <p className="report-notice" role="status">You have unsaved chart changes. Sharing uses the saved draft. Return to Analyze or Export to save those changes first.</p>}<ReportSharing report={report} /></>}
  </div>
}

function DataExport({ report }: { report: Report }) {
  function download() {
    const url = URL.createObjectURL(new Blob([report.data], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = 'openeval-results.json'; anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <section className="report-card"><h2>Export recorded results</h2><p>Download the normalized trial data for the CLI or another OpenEval workspace. Private evidence and team access are excluded.</p><button onClick={download}>Download results JSON</button></section>
}

function ReportSharing({ report }: { report: Report }) {
  const share = useMutation(api.reports.share), revoke = useMutation(api.reports.revoke), publish = useMutation(api.reportProjects.publish)
  const [busy, setBusy] = useState(false), [status, setStatus] = useState(''), [error, setError] = useState(''), [confirmRevoke, setConfirmRevoke] = useState(false)
  async function act(run: () => Promise<unknown>, success: string) {
    setBusy(true); setStatus(''); setError('')
    try { await run(); setStatus(success); setConfirmRevoke(false) } catch (e) { setError(message(e)) } finally { setBusy(false) }
  }
  if (report.role !== 'owner') return <section className="report-card"><h2>Sharing is managed by the owner</h2><p>{report.role === 'editor' ? 'You can save chart drafts. The owner reviews and publishes them.' : 'You can inspect saved drafts. Ask the owner to change access or publish a report.'}</p></section>
  const id = report.id, shareUrl = report.shareToken ? `${location.origin}/share#${report.shareToken}` : ''
  return <>
    <section className="report-card report-sharing" aria-label="Sharing controls">
      <span className="report-badge">{shareUrl ? 'Anyone with the link' : 'Public link off'}</span>
      <h2>{shareUrl ? 'Your report is ready to share' : 'Share when the result is ready'}</h2>
      <p>{report.publishedVersion === null ? 'Creating your first share link publishes the saved draft.' : `Published version ${report.publishedVersion}${report.version === report.publishedVersion ? ' matches the saved draft.' : ' stays visible until you publish the saved changes.'}`}</p>
      <p>Save chart edits in Analyze or Export before publishing. Evidence requires its own review and publication in Results. Invited teammates retain access when the public link is off.</p>
      {shareUrl && <label>Share link<input readOnly value={shareUrl} onFocus={event => event.target.select()} /></label>}
      <div className="report-actions">
        {!shareUrl && <button className="primary" disabled={busy} onClick={() => void act(() => share({ id, token: token() }), 'Share link created.')}>{busy ? 'Creating link…' : 'Create share link'}</button>}
        {shareUrl && <><button disabled={busy} onClick={() => void act(() => navigator.clipboard.writeText(shareUrl), 'Link copied.')}>Copy link</button><a href={shareUrl} target="_blank" rel="noreferrer">Open shared view ↗</a><button className="secondary" disabled={busy} onClick={() => setConfirmRevoke(true)}>Revoke link</button></>}
        {report.publishedVersion !== null && <button disabled={busy || report.version === report.publishedVersion} onClick={() => void act(() => publish({ id, expectedVersion: report.version }), 'Saved draft published. Shared viewers now see this version.')}>Publish saved draft</button>}
      </div>
      {confirmRevoke && <div className="report-confirm" role="group" aria-label="Confirm revocation"><p>Turn off this public link? Your saved report and invited teammates keep their access. Copies already downloaded cannot be recalled.</p><button disabled={busy} onClick={() => void act(() => revoke({ id }), 'Link revoked. Your report is still saved.')}>Yes, revoke link</button><button className="secondary" disabled={busy} onClick={() => setConfirmRevoke(false)}>Keep sharing</button></div>}
      {status && <p role="status">{status}</p>}{error && <p role="alert">{error}</p>}
    </section>
    <TeamAccess id={id} />
    <DeleteReport report={report} />
  </>
}

function DeleteReport({ report }: { report: Report }) {
  const remove = useMutation(api.reports.remove)
  const [open, setOpen] = useState(false), [confirmation, setConfirmation] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  return <section className="report-card" aria-label="Delete report"><h2>Delete report</h2><p>Permanently remove the saved data, chart drafts, evidence, team access and exports. Shared links will stop working. Downloaded copies cannot be recalled. Evaluation history remains.</p>
    {!open ? <button type="button" onClick={() => setOpen(true)}>Delete report</button> : <div className="report-confirm" role="group" aria-label="Confirm report deletion">
      <label>Type the report title to confirm<input value={confirmation} onChange={event => setConfirmation(event.target.value)} autoComplete="off" /></label><p>{report.title}</p>
      <button disabled={busy || confirmation !== report.title} onClick={async () => { setBusy(true); setError(''); try { await remove({ id: report.id }); location.assign('/library') } catch (e) { setError(message(e)); setBusy(false) } }}>Permanently delete report</button>
      <button disabled={busy} className="secondary" onClick={() => { setOpen(false); setConfirmation(''); setError('') }}>Keep report</button>
    </div>}{error && <p role="alert">{error}</p>}
  </section>
}
