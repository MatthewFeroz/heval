import { useCallback, type ReactNode } from 'react'
import { ConvexReactClient, ConvexProviderWithAuth } from 'convex/react'
import { useAppAuth } from '../auth'
import { WorkspaceLayout } from './WorkspaceLayout'
const url = import.meta.env.VITE_CONVEX_URL
const client = url ? new ConvexReactClient(url) : null
function useReportAuth() {
  const auth = useAppAuth(), getAccessToken = auth.getAccessToken
  const fetchAccessToken = useCallback(async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
    try { return await getAccessToken({ forceRefresh: forceRefreshToken }) ?? null } catch { return null }
  }, [getAccessToken])
  return { isLoading: auth.isLoading, isAuthenticated: !!auth.user, fetchAccessToken }
}
export function ReportProvider({ children }: { children: ReactNode }) {
  const evaluations = location.pathname === '/evaluations' || new URLSearchParams(location.search).has('new')
  const machines = ['/machines', '/settings'].includes(location.pathname)
  return client ? <ConvexProviderWithAuth client={client} useAuth={useReportAuth}>{children}</ConvexProviderWithAuth>
    : <WorkspaceLayout active={machines ? 'settings' : 'library'}><section className="report-card report-welcome"><span className="report-eyebrow">YOUR WORKSPACE</span><h1>{evaluations ? 'Evaluations are coming online' : machines ? 'Connect the machine that runs your evaluations.' : 'Your Library is coming online'}</h1><p>{evaluations ? 'Once workspace storage is connected, this page carries a comparison from configuration through sharing.' : machines ? 'Pair a Linux computer or cloud VM here, then create and follow a comparison in your Library.' : 'Run or import an evaluation, inspect the results and share when ready.'}</p><p className="report-notice">This deployment hasn’t connected its workspace storage yet.</p><a className="report-button" href="/explore">Explore published comparisons</a></section></WorkspaceLayout>
}
