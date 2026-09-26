import { useEffect, useMemo, type ReactNode } from 'react'
import { AuthKitProvider, useAuth } from '@workos-inc/authkit-react'
import { AuthContext, publicAuth, type AppAuth } from './auth'
import { authReturnUrl, requiresBrowserSession } from './auth-session'


function Connected({ children }: { children: (auth: AppAuth) => ReactNode }) {
  const { isLoading, user, signIn, signOut, getAccessToken } = useAuth()
  useEffect(() => {
    if (location.pathname !== '/login' || isLoading) return
    if (user) location.replace(authReturnUrl(undefined, location.origin))
    else void signIn({ state: { returnTo: '/evaluations' } })
  }, [isLoading, user, signIn])
  const auth = useMemo(() => ({ configured: true, isLoading, user, signIn: () => signIn({ state: { returnTo: authReturnUrl(location.href, location.origin) } }), signOut, getAccessToken }), [isLoading, user, signIn, signOut, getAccessToken])
  return <AuthContext.Provider value={auth}>{children(auth)}</AuthContext.Provider>
}

export function AuthBoundary({ children }: { children: (auth: AppAuth) => ReactNode }) {
  const clientId = import.meta.env.VITE_WORKOS_CLIENT_ID
  const apiHostname = import.meta.env.VITE_WORKOS_API_HOSTNAME?.trim() || undefined
  return clientId
    ? <AuthKitProvider clientId={clientId} apiHostname={apiHostname} devMode={requiresBrowserSession(apiHostname, location.hostname)} redirectUri={location.origin} onRedirectCallback={({ state }) => {
      location.replace(authReturnUrl(state?.returnTo, location.origin))
    }}><Connected>{children}</Connected></AuthKitProvider>
    : children(publicAuth)
}
