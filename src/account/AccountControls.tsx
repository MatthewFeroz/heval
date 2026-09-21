import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { ArrowUpRight, BookOpen, ChevronDown, FolderOpen, FlaskConical, LayoutDashboard, LogIn, LogOut, Monitor } from 'lucide-react'
import type { AppAuth } from '../auth'
import { guideHref } from '../onboarding/model'
import './account.css'

function SignIn({ auth }: { auth: AppAuth }) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  async function signIn() {
    setPending(true); setError('')
    try { await auth.signIn() } catch {
      setError('Couldn’t open sign-in. Please try again.')
      setPending(false)
    }
  }
  return <div className="account-controls">
    <button className="account-sign-in" type="button" disabled={pending} onClick={() => void signIn()}>
      {pending ? 'Opening sign-in…' : 'Sign in'}<LogIn size={15} aria-hidden="true" />
    </button>
    {error && <span className="account-error" role="alert">{error}</span>}
  </div>
}

function SignedInAccount({ auth, showWorkspaceLink }: { auth: AppAuth; showWorkspaceLink: boolean }) {
  const user = auth.user!
  const name = user.firstName?.trim() || 'Account'
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const initialFocus = useRef<'first' | 'last'>('first')
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0 })
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  useLayoutEffect(() => {
    if (!open) return
    function positionMenu() {
      if (!trigger.current || !panel.current) return
      const anchor = trigger.current.getBoundingClientRect()
      const menu = panel.current.getBoundingClientRect()
      setPosition({
        left: Math.max(8, Math.min(anchor.right - menu.width, window.innerWidth - menu.width - 8)),
        top: Math.max(8, Math.min(anchor.bottom + 8, window.innerHeight - menu.height - 8)),
      })
    }
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Node && !trigger.current?.contains(event.target) && !panel.current?.contains(event.target)) setOpen(false)
    }
    positionMenu()
    const items = panel.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)')
    items?.[initialFocus.current === 'last' ? items.length - 1 : 0]?.focus({ preventScroll: true })
    document.addEventListener('pointerdown', dismiss)
    window.addEventListener('resize', positionMenu)
    window.addEventListener('scroll', positionMenu, true)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      window.removeEventListener('resize', positionMenu)
      window.removeEventListener('scroll', positionMenu, true)
    }
  }, [open])

  function menuKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape' || event.key === 'Tab') {
      if (event.key === 'Escape') event.preventDefault()
      trigger.current?.focus({ preventScroll: true })
      setOpen(false)
      return
    }
    const items = Array.from(panel.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])
    const current = items.indexOf(document.activeElement as HTMLElement)
    let next: number | undefined
    if (event.key === 'ArrowDown') next = (current + 1) % items.length
    if (event.key === 'ArrowUp') next = (current - 1 + items.length) % items.length
    if (event.key === 'Home') next = 0
    if (event.key === 'End') next = items.length - 1
    if (next !== undefined) { event.preventDefault(); items[next]?.focus() }
  }

  async function signOut() {
    setPending(true); setError('')
    try { await auth.signOut() } catch {
      setError('Couldn’t sign out. Please try again.')
      setPending(false)
    }
  }

  const cliGuide = /^\/studio(?:\.html)?$/.test(location.pathname) ? guideHref(location.href) : '/studio?guide=cli'
  return <div className="account-controls">
    {showWorkspaceLink && <a className="account-studio-link" href="/evaluations">Create evaluation<ArrowUpRight size={14} aria-hidden="true" /></a>}
    <button className="account-trigger" type="button" ref={trigger} aria-label={`Account menu for ${user.firstName?.trim() || user.email}`} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => { initialFocus.current = 'first'; setOpen(!open) }}
      onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); initialFocus.current = event.key === 'ArrowUp' ? 'last' : 'first'; setOpen(true)
        }
      }}>
      <span className="account-avatar" aria-hidden="true">{(user.firstName?.trim() || user.email).slice(0, 1).toUpperCase()}</span>
      <span className="account-name">{name}</span><ChevronDown size={14} aria-hidden="true" />
    </button>
    {open && createPortal(<div className="account-menu" ref={panel} style={position} onKeyDown={menuKeyDown}
      onBlur={event => { if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget) && !trigger.current?.contains(event.relatedTarget)) setOpen(false) }}>
      <div className="account-identity"><span>Signed in as</span><strong>{name}</strong><span className="account-email">{user.email}</span></div>
      <div id={id} role="menu" aria-label="Account">
        <a className="account-menu-item" role="menuitem" tabIndex={-1} href="/evaluations"><FlaskConical size={16} aria-hidden="true" />Evaluations</a>
        <a className="account-menu-item" role="menuitem" tabIndex={-1} href="/studio"><LayoutDashboard size={16} aria-hidden="true" />Studio</a>
        <a className="account-menu-item" role="menuitem" tabIndex={-1} href="/reports"><FolderOpen size={16} aria-hidden="true" />Report library</a>
        <a className="account-menu-item" role="menuitem" tabIndex={-1} href="/machines"><Monitor size={16} aria-hidden="true" />Runner setup</a>
        <a className="account-menu-item" role="menuitem" tabIndex={-1} href={cliGuide} target="_blank" rel="noreferrer" onClick={() => { setOpen(false); trigger.current?.focus() }}><BookOpen size={16} aria-hidden="true" />CLI guide<span className="account-sr-only"> (opens in a new tab)</span><ArrowUpRight size={13} aria-hidden="true" /></a>
        <div className="account-menu-divider" role="separator" />
        <button className="account-menu-item" type="button" role="menuitem" tabIndex={-1} disabled={pending} onClick={() => void signOut()}><LogOut size={16} aria-hidden="true" />{pending ? 'Signing out…' : 'Sign out'}</button>
      </div>
      {error && <p className="account-error" role="alert">{error}</p>}
    </div>, document.body)}
  </div>
}

export function AccountControls({ auth, showWorkspaceLink = false, showSignIn = true }: { auth: AppAuth; showWorkspaceLink?: boolean; showSignIn?: boolean }) {
  if (!auth.configured) return null
  if (auth.isLoading) return <div className="account-controls"><span className="account-loading" role="status">Checking account…</span></div>
  if (auth.user) return <SignedInAccount key={auth.user.email} auth={auth} showWorkspaceLink={showWorkspaceLink} />
  return showSignIn ? <SignIn auth={auth} /> : null
}
