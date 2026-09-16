import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthBoundary } from '../AuthBoundary'
import { Studio } from './Studio'
import { HostedStudio } from '../reports/HostedStudio'
import { ReportProvider } from '../reports/ReportProvider'
import './studio.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthBoundary>{auth => new URLSearchParams(location.search).has('report')
      ? <ReportProvider><HostedStudio key={auth.user?.email || 'public'} /></ReportProvider>
      : <Studio key={auth.user?.email || 'public'} />}</AuthBoundary>
  </StrictMode>,
)
