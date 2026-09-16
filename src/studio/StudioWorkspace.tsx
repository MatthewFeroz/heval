import { Studio } from './Studio'
import { HostedStudio } from '../reports/HostedStudio'
import { ReportProvider } from '../reports/ReportProvider'

// Loaded only after StudioRoute confirms the session. Neither editor mounts
// or requests its data while the user is signed out or auth is still loading.
export default function StudioWorkspace() {
  return new URLSearchParams(location.search).has('report')
    ? <ReportProvider><HostedStudio /></ReportProvider>
    : <Studio />
}
