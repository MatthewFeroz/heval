// Browser-test entry only. It is not an input to either production build.
import { createRoot } from 'react-dom/client'
import { AuthContext, type AppAuth } from '../../src/auth'
import { RunWorkbench } from '../../src/RunWorkbench'
import { Studio } from '../../src/studio/Studio'
import '../../src/styles.css'
import '../../src/workbench.css'
import '../../src/studio/studio.css'
const auth: AppAuth = { configured: true, isLoading: false, user: { email: 'browser-test@example.invalid' },
  signIn() {}, signOut() {}, async getAccessToken() { return 'browser-test-token' } }
createRoot(document.getElementById('root')!).render(<AuthContext.Provider value={auth}>
  {location.pathname === '/studio' ? <Studio /> : <RunWorkbench auth={auth} />}
</AuthContext.Provider>)
