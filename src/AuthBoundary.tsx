import { useEffect, useMemo, type ReactNode } from 'react'
import { ClerkProvider, SignIn, SignUp, useAuth, useClerk, useUser } from '@clerk/react'
import { AuthContext, publicAuth, type AppAuth } from './auth'
import { authReturnUrl, signInUrl } from './auth-session'

function Connected({ children }: { children: (auth: AppAuth) => ReactNode }) {
  const { isLoaded, isSignedIn, getToken } = useAuth()
  const { user, isLoaded: userLoaded } = useUser()
  const { signOut } = useClerk()
  const params = new URLSearchParams(location.search)
  const returnTo = authReturnUrl(params.get('returnTo'), location.origin)
  const login = location.pathname === '/login' || location.pathname === '/login/'
  const authOrigin = import.meta.env.VITE_HEVAL_AUTH_ORIGIN || location.origin
  const moveLogin = login && new URL(authOrigin).origin !== location.origin
  const canonicalLogin = signInUrl(returnTo, authOrigin)
  useEffect(() => {
    if (moveLogin) location.replace(canonicalLogin)
    else if (login && isLoaded && isSignedIn) location.replace(returnTo)
  }, [login, isLoaded, isSignedIn, returnTo, moveLogin, canonicalLogin])
  const auth = useMemo<AppAuth>(() => ({
    configured: true, isLoading: !isLoaded || !userLoaded,
    user: isSignedIn && user ? { email: user.primaryEmailAddress?.emailAddress ?? '', firstName: user.firstName } : null,
    signIn: () => location.assign(signInUrl(location.href, import.meta.env.VITE_HEVAL_AUTH_ORIGIN || location.origin)),
    signOut: () => { void signOut({ redirectUrl: '/' }) },
    getAccessToken: async options => await getToken({ template: 'convex', skipCache: options?.forceRefresh }) ?? undefined,
  }), [isLoaded, userLoaded, isSignedIn, user, signOut, getToken])
  if (login) {
    if (moveLogin || !isLoaded || isSignedIn) return <p>Loading your workspace…</p>
    const query = `?returnTo=${encodeURIComponent(returnTo)}`
    return <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}>
      {params.get('flow') === 'sign-up'
        ? <SignUp routing="hash" signInUrl={`/login${query}`} forceRedirectUrl={returnTo} />
        : <SignIn routing="hash" signUpUrl={`/login${query}&flow=sign-up`} forceRedirectUrl={returnTo} />}
    </main>
  }
  return <AuthContext.Provider value={auth}>{children(auth)}</AuthContext.Provider>
}

export function AuthBoundary({ children }: { children: (auth: AppAuth) => ReactNode }) {
  const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY
  return publishableKey
    ? <ClerkProvider publishableKey={publishableKey} signInUrl="/login" signUpUrl="/login?flow=sign-up" afterSignOutUrl="/" allowedRedirectOrigins={[location.origin]}>
      <Connected>{children}</Connected>
    </ClerkProvider>
    : children(publicAuth)
}
