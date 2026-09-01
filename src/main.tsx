import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthKitProvider, useAuth } from '@workos-inc/authkit-react'
import App, { type AppAuth } from './App'
import './styles.css'

const clientId = import.meta.env.VITE_WORKOS_CLIENT_ID
const apiHostname = import.meta.env.VITE_WORKOS_API_HOSTNAME || undefined

// This is the application entry point, not a reusable Fast Refresh module.
// eslint-disable-next-line react-refresh/only-export-components
function AuthenticatedApp() {
  const { isLoading, user, signIn, signOut, getAccessToken } = useAuth()
  useEffect(() => {
    if (location.pathname === '/login') signIn()
  }, [signIn])
  const auth: AppAuth = { configured: true, isLoading, user, signIn, signOut, getAccessToken }
  return <App auth={auth} />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {clientId
      ? <AuthKitProvider clientId={clientId} apiHostname={apiHostname}><AuthenticatedApp /></AuthKitProvider>
      : <App />}
  </StrictMode>,
)
