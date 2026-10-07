export function authReturnUrl(returnTo: unknown, origin: string): string {
  const fallback = new URL('/evaluations', origin).href
  if (typeof returnTo !== 'string') return fallback
  try {
    const target = new URL(returnTo, origin)
    if (target.origin !== origin || ['/', '/index.html', '/login', '/login/'].includes(target.pathname)) return fallback
    return target.href
  } catch { return fallback }
}

// Move the requested path to the canonical workspace before sign-in. Never
// carry an arbitrary source origin into Clerk's post-login redirect.
export function signInUrl(current: string, authOrigin: string): string {
  const origin = new URL(authOrigin).origin
  const source = new URL(current)
  const destination = authReturnUrl(source.pathname + source.search + source.hash, origin)
  const login = new URL('/login', origin)
  login.searchParams.set('returnTo', destination)
  return login.href
}
