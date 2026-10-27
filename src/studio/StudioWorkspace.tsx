import { Studio } from './Studio'
import { ReportWorkspace } from '../reports/ReportWorkspace'
import { WorkspaceLayout } from '../reports/WorkspaceLayout'
import type { Id } from '../../convex/_generated/dataModel'
import { ReportProvider } from '../reports/ReportProvider'
import '../reports/reports.css'

// Loaded only after StudioRoute confirms the session. Neither editor mounts
// or requests its data while the user is signed out or auth is still loading.
export default function StudioWorkspace() {
  return new URLSearchParams(location.search).has('report')
    ? <ReportProvider><WorkspaceLayout active="library"><ReportWorkspace id={new URLSearchParams(location.search).get('report') as Id<'reports'>} /></WorkspaceLayout></ReportProvider>
    : <Studio />
}
