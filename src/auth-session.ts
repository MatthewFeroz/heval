// api.workos.com cannot set Heval's first-party session cookie. Use AuthKit's
// browser-persisted refresh token for staging/localhost; custom auth domains
// keep the SDK's HttpOnly-cookie session mode.
export function requiresBrowserSession(apiHostname: string | undefined, hostname: string) {
  return !apiHostname || apiHostname === 'api.workos.com' || hostname === 'localhost' || hostname === '127.0.0.1'
}

export function authReturnUrl(returnTo: unknown, origin: string): string {
  const fallback = new URL('/evaluations', origin).href
  if (typeof returnTo !== 'string') return fallback
  try {
    const target = new URL(returnTo, origin)
    if (target.origin !== origin || ['/', '/index.html', '/login', '/login/'].includes(target.pathname)) return fallback
    return target.href
  } catch { return fallback }
}
