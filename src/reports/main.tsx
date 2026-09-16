import { Component, StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { ReportProvider } from './ReportProvider'
import { AuthBoundary } from '../AuthBoundary'
import { ReportsApp } from './ReportsApp'
import './reports.css'

class ReportErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    return this.state.failed ? <main className="report-shell"><h1>Couldn’t load this report</h1><p>Check your connection and that you’re signed into the right account.</p><a href="/reports">Return to your reports</a></main> : this.props.children
  }
}

createRoot(document.getElementById('root')!).render(<StrictMode><ReportErrorBoundary>
  <AuthBoundary>{() => <ReportProvider><ReportsApp /></ReportProvider>}</AuthBoundary>
</ReportErrorBoundary></StrictMode>)
