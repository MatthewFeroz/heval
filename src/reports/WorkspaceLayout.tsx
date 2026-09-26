import { useState, type ReactNode } from 'react'
import { useAppAuth } from '../auth'
import { Brand, type WorkspaceSection } from '../components/SiteHeader'
import { AccountControls } from '../account/AccountControls'
import { PanelLeftClose, PanelLeftOpen, FlaskConical, FolderOpen, Monitor, PanelsTopLeft } from 'lucide-react'
import { Tour } from '../tour/Tour'
import './workspace.css'

const sections = [
  { id: 'evaluations', href: '/evaluations', label: 'Evaluations', icon: FlaskConical },
  { id: 'machines', href: '/machines', label: 'Runner setup', icon: Monitor },
  { id: 'reports', href: '/reports', label: 'Report library', icon: FolderOpen },
  { id: 'studio', href: '/studio', label: 'Studio', icon: PanelsTopLeft },
] as const

export function WorkspaceLayout({ active, children, editor = false }: { active: WorkspaceSection; children: ReactNode; editor?: boolean }) {
  const auth = useAppAuth()
  const [navigationOpen, setNavigationOpen] = useState(() => {
    try { return localStorage.getItem('heval.workspace.navigation') !== 'closed' } catch { return true }
  })
  function toggleNavigation() {
    const next = !navigationOpen
    setNavigationOpen(next)
    try { localStorage.setItem('heval.workspace.navigation', next ? 'open' : 'closed') } catch { /* Navigation still works when storage is unavailable. */ }
  }
  return <div className={`workspace-page${editor ? ' workspace-editor-page' : ''}`} data-navigation-open={navigationOpen}>
    <a className="workspace-skip" href="#workspace-main">Skip to content</a>
    <aside className="workspace-sidebar">
      <div className="workspace-brand">{navigationOpen && <Brand />}<button className="workspace-navigation-toggle" type="button" aria-expanded={navigationOpen} aria-controls="workspace-navigation" aria-label={navigationOpen ? 'Collapse workspace navigation' : 'Expand workspace navigation'} title={navigationOpen ? 'Collapse workspace' : 'Expand workspace'} onClick={toggleNavigation}>{navigationOpen ? <PanelLeftClose size={18} aria-hidden="true" /> : <PanelLeftOpen size={18} aria-hidden="true" />}</button></div>
      <nav id="workspace-navigation" aria-label="Main navigation" hidden={!navigationOpen}>{sections.map(({ id, href, label, icon: Icon }) => <a key={id} href={href} aria-current={active === id ? 'page' : undefined}><Icon size={16} aria-hidden="true" />{label}</a>)}</nav>
      {navigationOpen && <div className="workspace-sidebar-note">Coding-agent evaluations</div>}
    </aside>
    {editor ? <div id="workspace-main" className="workspace-editor-content" tabIndex={-1}>{children}</div> : <>
    <header className="workspace-topbar"><div className="workspace-breadcrumb"><strong>{sections.find(s => s.id === active)?.label}</strong></div><AccountControls auth={auth} appearance="workspace" showSignIn={false} /></header>
    <main className="report-shell" id="workspace-main" tabIndex={-1}>{children}<Tour /></main>
    <footer className="report-footer report-shell"><span>Heval · Coding-agent evaluations</span><a href="/">Back to Heval ↗</a></footer>
    </>}

  </div>
}
