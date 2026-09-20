import { Component, StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { ReportProvider } from './ReportProvider'
import { AuthBoundary } from '../AuthBoundary'
import { ReportsApp } from './ReportsApp'
import { EvaluationApp } from '../runners/EvaluationApp'
import { RunnerApp } from '../runners/RunnerApp'
import { WorkspaceLayout } from './WorkspaceLayout'
import './reports.css'

class ReportErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    return this.state.failed ? <WorkspaceLayout active="reports"><section className="report-card report-welcome"><h1>Couldn’t load this report</h1><p>Check your connection and that you’re signed into the right account.</p><a href="/reports">Return to your reports</a></section></WorkspaceLayout> : this.props.children
  }
}

createRoot(document.getElementById('root')!).render(<StrictMode><ReportErrorBoundary>
  <AuthBoundary>{auth => <ReportProvider>{location.pathname === '/evaluations' ? <EvaluationApp key={auth.user?.email ?? 'public'} /> : location.pathname === '/machines' ? <RunnerApp key={auth.user?.email ?? 'public'} /> : <ReportsApp key={auth.user?.email ?? 'public'} />}</ReportProvider>}</AuthBoundary>
</ReportErrorBoundary></StrictMode>)
