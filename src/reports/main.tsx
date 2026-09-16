import { Component, StrictMode, useCallback, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { ConvexReactClient, ConvexProviderWithAuth } from 'convex/react'
import { AuthBoundary } from '../AuthBoundary'
import { useAppAuth } from '../auth'
import { ReportsApp } from './ReportsApp'
import './reports.css'

const url = import.meta.env.VITE_CONVEX_URL
const client = url ? new ConvexReactClient(url) : null

function useReportAuth() {
  const auth = useAppAuth()
  const getAccessToken = auth.getAccessToken
  const fetchAccessToken = useCallback(async ({ forceRefreshToken }: { forceRefreshToken: boolean }) => {
    try { return await getAccessToken({ forceRefresh: forceRefreshToken }) ?? null } catch { return null }
  }, [getAccessToken])
  return { isLoading: auth.isLoading, isAuthenticated: !!auth.user, fetchAccessToken }
}

class ReportErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    return this.state.failed ? <main className="report-shell"><h1>Couldn’t load this report</h1><p>Check your connection and that you’re signed into the right account.</p><a href="/reports">Return to your reports</a></main> : this.props.children
  }
}

createRoot(document.getElementById('root')!).render(<StrictMode><ReportErrorBoundary>
  {client ? <AuthBoundary>{() => <ConvexProviderWithAuth client={client} useAuth={useReportAuth}><ReportsApp /></ConvexProviderWithAuth>}</AuthBoundary>
    : <main className="report-shell"><a href="/">Heval</a><h1>Saved reports are coming online</h1><p>This deployment hasn’t connected its report storage yet. You can still explore an export in Studio.</p><a href="/studio">Open Studio</a></main>}
</ReportErrorBoundary></StrictMode>)
