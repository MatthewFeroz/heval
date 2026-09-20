import type { ReactNode } from 'react'
import { useAppAuth } from '../auth'
import { SiteHeader, type WorkspaceSection } from '../components/SiteHeader'

export function WorkspaceLayout({ active, children }: { active: WorkspaceSection; children: ReactNode }) {
  const auth = useAppAuth()
  return <div className="workspace-page">
    <SiteHeader auth={auth} active={active} />
    <main className="report-shell">{children}</main>
    <footer className="report-footer report-shell"><span>Heval · Coding-agent evaluations</span><a href="/">Back to Heval ↗</a></footer>
  </div>
}
