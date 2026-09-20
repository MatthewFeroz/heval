import { AccountControls } from '../account/AccountControls'
import type { AppAuth } from '../auth'
import './site-header.css'

export type WorkspaceSection = 'machines' | 'evaluations' | 'reports' | 'studio'

export function Brand({ className = '' }: { className?: string }) {
  return <a className={`site-brand ${className}`} href="/" aria-label="Heval home">heval</a>
}

export function SiteHeader({ auth, active, workspace = Boolean(active) }: { auth: AppAuth; active?: WorkspaceSection; workspace?: boolean }) {
  return <header className="site-header nav-wrap">
    <nav className="site-nav nav shell" aria-label="Main navigation">
      <Brand className="brand" />
      <div className="site-nav-actions nav-actions">
        {workspace ? <div className="site-workspace-links">
          <a href="/machines" aria-current={active === 'machines' ? 'page' : undefined}>Machines</a>
          <a href="/evaluations" aria-current={active === 'evaluations' ? 'page' : undefined}>Evaluations</a>
          <a href="/reports" aria-current={active === 'reports' ? 'page' : undefined}>Your reports</a>
          <a href="/studio" aria-current={active === 'studio' ? 'page' : undefined}>Studio</a>
        </div> : <a className="site-github nav-github" href="https://github.com/MatthewFeroz/heval" target="_blank" rel="noreferrer">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5C5.65.5.5 5.65.5 12a11.5 11.5 0 007.86 10.93c.58.1.79-.25.79-.56v-2c-3.2.69-3.88-1.37-3.88-1.37-.52-1.33-1.27-1.69-1.27-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.02 1.76 2.68 1.25 3.33.96.1-.75.4-1.25.72-1.54-2.55-.29-5.24-1.27-5.24-5.67 0-1.25.45-2.28 1.18-3.08-.12-.29-.51-1.45.11-3.02 0 0 .96-.31 3.15 1.18a10.96 10.96 0 015.74 0c2.19-1.49 3.15-1.18 3.15-1.18.62 1.57.23 2.73.11 3.02.74.8 1.18 1.83 1.18 3.08 0 4.41-2.7 5.38-5.27 5.66.41.36.78 1.06.78 2.13v3.16c0 .31.21.67.8.56A11.5 11.5 0 0023.5 12C23.5 5.65 18.35.5 12 .5z" /></svg>
          GitHub
        </a>}
        <AccountControls auth={auth} showStudioLink={!workspace} showSignIn={!active} />
      </div>
    </nav>
  </header>
}
