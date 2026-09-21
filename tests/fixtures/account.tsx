// Isolated account states for browser tests. Not a production entry point.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AccountControls } from '../../src/account/AccountControls'
import type { AppAuth } from '../../src/auth'

export function Fixture() {
  const params = new URLSearchParams(location.search)
  const [session, setSession] = useState(params.get('session') || 'member')
  const [signOutCount, setSignOutCount] = useState(0)
  const user = { firstName: 'Matt', email: 'matt@example.invalid' }
  const auth: AppAuth = {
    configured: session !== 'unconfigured', isLoading: session === 'loading',
    user: ['member', 'loading'].includes(session) ? user : null,
    async signIn() {
      if (params.has('error')) throw new Error('Test login failure')
      setSession('member')
    },
    async signOut() {
      setSignOutCount(value => value + 1)
      if (params.has('error')) throw new Error('Test logout failure')
      setSession('guest')
    },
    async getAccessToken() { return undefined },
  }
  return <div style={{ background: '#0b0b0b', color: '#f4f4f5', minHeight: '100vh', fontFamily: 'system-ui' }}>
    <header style={{ position: 'sticky', top: 0, overflowX: 'auto', background: '#101010', padding: 16, backdropFilter: 'blur(18px)' }}>
      <nav style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 20, minWidth: params.has('overflow') ? 900 : undefined }}>
        <a href="#home" style={{ color: 'white', fontSize: 24 }}>heval</a>
        <AccountControls auth={auth} showWorkspaceLink />
      </nav>
    </header>
    <main style={{ padding: 24 }}><h1>Account navigation</h1><button>Outside control</button><output aria-label="Sign-out attempts">{signOutCount}</output></main>
  </div>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
