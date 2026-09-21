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
  const evaluations = location.pathname === '/evaluations'
  const machines = location.pathname === '/machines'
  return client ? <ConvexProviderWithAuth client={client} useAuth={useReportAuth}>{children}</ConvexProviderWithAuth>
    : <WorkspaceLayout active={evaluations ? 'evaluations' : machines ? 'machines' : 'reports'}><section className="report-card report-welcome"><span className="report-eyebrow">YOUR WORKSPACE</span><h1>{evaluations ? 'Evaluations are coming online' : machines ? 'Connect the machine that runs your evaluations.' : 'Saved reports are coming online'}</h1><p>{evaluations ? 'Once workspace storage is connected, this page carries an evaluation from configuration through publishing.' : machines ? 'Pair a Linux computer or cloud VM here, then create and follow the evaluation from Evaluations.' : 'Import an evaluation, save it privately, then share it on your terms.'}</p><p className="report-notice">This deployment hasn’t connected its workspace storage yet.</p><a className="report-button" href="/studio">Open Studio</a></section></WorkspaceLayout>
}
