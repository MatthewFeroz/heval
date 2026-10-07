/** Auth boundary contract checks. Live Clerk credential entry and session
 * restoration are verified separately against the configured hosted app. */
import assert from 'node:assert/strict'
import { authReturnUrl, signInUrl } from '../src/auth-session'
import { authorizedFetch, publicAuth } from '../src/auth'

const origin = 'https://heval.example.com'
for (const value of [undefined, '/', '/login', '/login/', '/index.html', '//evil.invalid', 'javascript:alert(1)', 'https://evil.invalid']) {
  assert.equal(authReturnUrl(value, origin), `${origin}/evaluations`)
}
const requested = '/studio?report=saved-report&recipe=scatter#draft'
assert.equal(authReturnUrl(requested, origin), origin + requested)
const login = new URL(signInUrl('https://worker.example.com' + requested, origin))
assert.equal(login.origin, origin)
assert.equal(login.pathname, '/login')
assert.equal(login.searchParams.get('returnTo'), origin + requested)
assert.equal(new URL(signInUrl('https://worker.example.com/login?returnTo=https://evil.invalid', origin)).searchParams.get('returnTo'), origin + '/evaluations')

const previousFetch = globalThis.fetch
const previousLocation = Object.getOwnPropertyDescriptor(globalThis, 'location')
Object.defineProperty(globalThis, 'location', { configurable: true, value: { origin } })
let calls = 0
let headers: Headers, redirect: RequestRedirect | undefined
const auth = { ...publicAuth, async getAccessToken() { calls++; return 'isolated-test-token' } }
globalThis.fetch = Object.assign(async (_input: RequestInfo | URL, init?: RequestInit) => { headers = new Headers(init?.headers); redirect = init?.redirect; return new Response('ok') }, { preconnect: previousFetch.preconnect })
try {
  await authorizedFetch(auth, '/api/presentation-export?job=example')
  assert.equal(headers!.get('authorization'), 'Bearer isolated-test-token')
  assert.equal(redirect, 'error')
  await authorizedFetch(auth, 'https://external.example.com/api/data')
  assert.equal(headers!.has('authorization'), false)
  await authorizedFetch(auth, '/results/report.json')
  assert.equal(headers!.has('authorization'), false)
  assert.equal(calls, 1)
  await authorizedFetch(publicAuth, '/api/private')
  assert.equal(headers!.has('authorization'), false)
  console.log('PASS: canonical login destination, full deep-link preservation, external redirect rejection, and API token isolation. Live Clerk session checks require a configured application.')
} finally {
  globalThis.fetch = previousFetch
  if (previousLocation) Object.defineProperty(globalThis, 'location', previousLocation)
  else Reflect.deleteProperty(globalThis, 'location')
}
