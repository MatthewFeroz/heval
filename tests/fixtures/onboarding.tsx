// Browser-only fixture. The production build does not include this entry.
import { createRoot } from 'react-dom/client'
import { AuthContext, type AppAuth } from '../../src/auth'
import { GuideGate } from '../../src/onboarding/GuideGate'
import type { GuideStore, GuideProgress } from '../../src/onboarding/model'
import '../../src/studio/studio.css'

const params = new URLSearchParams(location.search)
const account = params.get('account') || 'alice'
const key = `test-guide:${account}`
const auth: AppAuth = { configured: true, isLoading: false, user: { email: `${account}@example.invalid` }, signIn() {}, signOut() {}, async getAccessToken() { return 'browser-test-token' } }
const store: GuideStore = {
  async load() {
    if (params.has('loadError') && !sessionStorage.getItem('test-guide-retry')) { sessionStorage.setItem('test-guide-retry', '1'); throw new Error('Offline') }
    return JSON.parse(localStorage.getItem(key) || 'null')
  },
  async save(progress) {
    if (params.has('saveError')) throw new Error('Offline')
    const previous = JSON.parse(localStorage.getItem(key) || 'null') as GuideProgress | null
    if (previous?.status === 'completed' || (previous?.status === 'skipped' && progress.status !== 'completed')) return previous
    const next = { ...progress, step: Math.max(previous?.step ?? 0, progress.step) }
    localStorage.setItem(key, JSON.stringify(next))
    return next
  },
}
createRoot(document.getElementById('root')!).render(<AuthContext.Provider value={auth}><GuideGate store={store}>
  <main><h1>Test workspace</h1><a href="?guide=cli">CLI guide</a><p>Requested page: {location.pathname}{location.search}{location.hash}</p></main>
</GuideGate></AuthContext.Provider>)
