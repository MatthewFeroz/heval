import { WorkspaceLayout } from './WorkspaceLayout'
import { PageHeader } from './PageHeader'
import { RunDatabase } from '../landing/RunDatabase'

export function ExploreApp() {
  return <WorkspaceLayout active="explore"><PageHeader title="Explore">Inspect published comparisons, their recorded conditions and individual task outcomes.</PageHeader><RunDatabase /></WorkspaceLayout>
}
