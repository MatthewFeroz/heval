import { Component, StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { ReportProvider } from './ReportProvider'
import { AuthBoundary } from '../AuthBoundary'
import { ReportsApp } from './ReportsApp'
import { EvaluationApp } from '../runners/EvaluationApp'
import { RunnerApp } from '../runners/RunnerApp'
import { WorkspaceLayout } from './WorkspaceLayout'
import { ExploreApp } from './ExploreApp'
import './reports.css'

class ReportErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    return this.state.failed ? <WorkspaceLayout active="reports"><section className="report-card report-welcome"><h1>Couldn’t load this report</h1><p>Check your connection and that you’re signed into the right account.</p><a href="/reports">Return to your reports</a></section></WorkspaceLayout> : this.props.children
  }
}

const params = new URLSearchParams(location.search)
const evaluation = location.pathname === '/evaluations' || location.pathname === '/library' && ['new', 'experiment', 'managed', 'run', 'baseline', 'custom'].some(key => params.has(key))
createRoot(document.getElementById('root')!).render(<StrictMode><ReportErrorBoundary>
  <AuthBoundary>{auth => location.pathname === '/explore' ? <ExploreApp /> : <ReportProvider>{evaluation ? <EvaluationApp key={auth.user?.email ?? 'public'} /> : ['/machines', '/settings'].includes(location.pathname) ? <RunnerApp key={auth.user?.email ?? 'public'} /> : <ReportsApp key={auth.user?.email ?? 'public'} />}</ReportProvider>}</AuthBoundary>
</ReportErrorBoundary></StrictMode>)
