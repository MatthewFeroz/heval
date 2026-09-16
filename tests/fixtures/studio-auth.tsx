// Test-only session controls. This entry is never included in a production build.
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthContext, type AppAuth } from '../../src/auth'
import { StudioRoute } from '../../src/studio/StudioRoute'
import '../../src/studio/studio.css'

export function Fixture() {
  const [session, setSession] = useState(new URLSearchParams(location.search).get('authState') || 'guest')
  const [requested, setRequested] = useState('')
  const auth: AppAuth = {
    configured: session !== 'unconfigured', isLoading: session === 'loading',
    user: ['member', 'loading'].includes(session) ? { email: 'studio-test@example.invalid' } : null,
    async signIn() {
      if (new URLSearchParams(location.search).has('authError')) throw new Error('Test sign-in failure')
      setRequested(location.pathname + location.search + location.hash)
    },
    signOut() { setSession('guest') },
    async getAccessToken() { return session === 'member' ? 'browser-test-token' : undefined },
  }
  return <AuthContext.Provider value={auth}>
    <aside aria-label="Test session controls">
      <button onClick={() => setSession('member')}>Complete test sign-in</button>
      <button onClick={() => setSession('guest')}>Expire test session</button>
      <output aria-label="Requested sign-in destination">{requested}</output>
    </aside>
    <StudioRoute />
  </AuthContext.Provider>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
