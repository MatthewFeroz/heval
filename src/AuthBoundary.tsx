import { useEffect, useMemo, type ReactNode } from 'react'
import { AuthKitProvider, useAuth } from '@workos-inc/authkit-react'
import { AuthContext, publicAuth, type AppAuth } from './auth'

function Connected({ children }: { children: (auth: AppAuth) => ReactNode }) {
  const { isLoading, user, signIn, signOut, getAccessToken } = useAuth()
  useEffect(() => {
    if (location.pathname === '/login') void signIn()
  }, [signIn])
  const auth = useMemo(() => ({ configured: true, isLoading, user, signIn: () => { void signIn({ state: { returnTo: location.pathname + location.search + location.hash } }) }, signOut, getAccessToken }), [isLoading, user, signIn, signOut, getAccessToken])
  return <AuthContext.Provider value={auth}>{children(auth)}</AuthContext.Provider>
}

export function AuthBoundary({ children }: { children: (auth: AppAuth) => ReactNode }) {
  const clientId = import.meta.env.VITE_WORKOS_CLIENT_ID
  return clientId
    ? <AuthKitProvider clientId={clientId} apiHostname={import.meta.env.VITE_WORKOS_API_HOSTNAME || undefined} redirectUri={location.origin} onRedirectCallback={({ state }) => {
      if (typeof state?.returnTo !== 'string') return
      try {
        const target = new URL(state.returnTo, location.origin)
        if (target.origin === location.origin && target.pathname !== '/login') location.replace(target.href)
      } catch { /* Invalid optional return path. */ }
    }}><Connected>{children}</Connected></AuthKitProvider>
    : children(publicAuth)
}
