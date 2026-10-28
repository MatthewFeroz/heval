import { useSyncExternalStore } from 'react'
import { useConvexAuth, useQuery, useConvexConnectionState } from 'convex/react'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { useAppAuth } from '../auth'
import { WorkspaceLayout } from './WorkspaceLayout'
import { ProjectReportView } from './ProjectReportView'
import { AcceptInvitation } from './TeamAccess'
import { ReportWorkspace } from './ReportWorkspace'
import { Library } from './Library'

function subscribeHashChange(listener: () => void) { window.addEventListener('hashchange', listener); return () => window.removeEventListener('hashchange', listener) }

function SharedReport() {
  const shareToken = useSyncExternalStore(subscribeHashChange, () => location.hash.slice(1))
  const report = useQuery(api.reports.shared, { token: shareToken })
  const connection = useConvexConnectionState()
  if (!connection.isWebSocketConnected) return <section className="report-card"><h1>Checking report access…</h1><p>Connect to the internet to view this shared report.</p></section>
  if (report === undefined) return <p role="status">Loading shared report…</p>
  if (!report) return <section className="report-card"><h1>This link is unavailable</h1><p>It may have been revoked, or the link is incorrect. Ask the report owner for a new link.</p><a href="/library">Go to Library</a></section>
  return <><p className="report-notice">Shared report · Read only · No sign-in required · Published version {report.version}</p><ProjectReportView data={report.data} project={report.project} evidence={report.evidence} /></>
}

export function ReportsApp() {
  const auth = useAppAuth()
  const { isLoading, isAuthenticated } = useConvexAuth()
  const isShared = location.pathname === '/share'
  const hash = useSyncExternalStore(subscribeHashChange, () => location.hash)
  const invitation = hash.startsWith('#invite=') ? hash.slice(8) : null
  const params = new URLSearchParams(location.search)
  const id = params.get('report') ?? params.get('id')
  return <WorkspaceLayout active="library">
    {isShared ? <SharedReport /> : isLoading ? <p role="status">Connecting your workspace…</p> : !isAuthenticated ? <section className="report-card report-welcome"><span className="report-eyebrow">IMPORT → SAVE → SHARE</span><h1>Your evaluations, ready to share.</h1><p>Sign in to save reports privately and manage who can open them.</p>{auth.configured ? <button className="primary" onClick={auth.signIn}>Sign in to your workspace</button> : <p>Sign-in isn’t configured on this deployment yet.</p>}{auth.user && <p role="alert">Your account hasn’t connected to report storage. Try signing out and back in.</p>}</section> : invitation ? <AcceptInvitation token={invitation} /> : id ? <ReportWorkspace id={id as Id<'reports'>} /> : <Library />}
  </WorkspaceLayout>
}
