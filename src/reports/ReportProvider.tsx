import { useCallback, type ReactNode } from 'react'
import { ConvexReactClient, ConvexProviderWithAuth } from 'convex/react'
import { useAppAuth } from '../auth'
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
  return client ? <ConvexProviderWithAuth client={client} useAuth={useReportAuth}>{children}</ConvexProviderWithAuth>
    : <main className="report-shell"><a href="/">Heval</a><h1>Saved reports are coming online</h1><p>This deployment hasn’t connected its report storage yet. You can still explore an export in Studio.</p><a href="/studio">Open Studio</a></main>
}
