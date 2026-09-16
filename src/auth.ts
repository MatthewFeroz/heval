import { createContext, useContext } from 'react'
export type AppAuth = {
  configured: boolean
  isLoading: boolean
  user: { email: string; firstName?: string | null } | null
  signIn: () => void
  signOut: () => void
  getAccessToken: () => Promise<string | undefined>
}
export const publicAuth: AppAuth = { configured: false, isLoading: false, user: null, signIn() {}, signOut() {}, async getAccessToken() { return undefined } }

export async function authorizedFetch(auth: AppAuth, input: string, init: RequestInit = {}) {
  const url = new URL(input, location.origin)
  const headers = new Headers(init.headers)
  // Imported projects can name external sources. Never send their host a token.
  if (url.origin === location.origin && url.pathname.startsWith('/api/')) {
    const token = await auth.getAccessToken()
    if (token) headers.set('authorization', `Bearer ${token}`)
  }
  return fetch(input, { ...init, headers, redirect: headers.has('authorization') ? 'error' : 'follow' })
}

export const AuthContext = createContext<AppAuth>(publicAuth)
export const useAppAuth = () => useContext(AuthContext)
