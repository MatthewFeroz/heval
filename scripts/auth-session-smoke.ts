/** Exercise the real AuthKit SDK on a non-localhost origin. Remote WorkOS and
 * optional onboarding HTTP responses are simulated; no context/session flags bypass
 * the app. Fake tokens never reach a backend or leave this browser context. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { build, preview } from 'vite'
import { chromium, expect, type BrowserContext } from '@playwright/test'
import { authReturnUrl, requiresBrowserSession } from '../src/auth-session'
import viteConfig from '../vite.config'
import type { GuideProgress } from '../src/onboarding/model'

const origin = 'https://heval-auth-test.invalid'
const clientId = 'client_heval_session_test'
const tokenKey = `workos:refresh-token:${clientId}`
const email = 'session-test@example.invalid'
const job = 'terminal-bench-comparison'
const onboarding = process.env.HEVAL_TEST_ONBOARDING === '1'
const accountStorage = 'https://heval-onboarding-test.convex.cloud'
let guideProgress: GuideProgress | null = null
assert.equal(requiresBrowserSession(undefined, 'example.vercel.app'), true)
assert.equal(requiresBrowserSession('api.workos.com', 'example.vercel.app'), true)
assert.equal(requiresBrowserSession('auth.example.com', 'app.example.com'), false)
assert.equal(requiresBrowserSession('auth.example.com', 'localhost'), true)
for (const value of [undefined, '/', '/login', '/login/', '/index.html', '//evil.invalid', 'javascript:alert(1)', 'https://evil.invalid']) {
  assert.equal(authReturnUrl(value, origin), `${origin}/studio`)
}

process.env.VITE_WORKOS_CLIENT_ID = clientId
process.env.VITE_WORKOS_API_HOSTNAME = ''
process.env.VITE_CONVEX_URL = onboarding ? accountStorage : ''
process.env.VITE_HEVAL_STATIC_SITE = '1'
await build({ ...viteConfig, configFile: false, logLevel: 'error' })
const server = await preview({ configFile: false, preview: { host: '127.0.0.1', port: 0 } })
const local = server.resolvedUrls!.local[0]
const browser = await chromium.launch()
const errors: string[] = []
const diagnostics: string[] = []
async function session(viewport = { width: 1440, height: 900 }) {
  const context = await browser.newContext({ viewport, serviceWorkers: 'block' })
  const stats = { authorizations: 0, exchanges: 0, refreshes: 0, rejectRefresh: false }
  let challenge = '', refreshToken = 'test-refresh-0'
  context.on('page', page => {
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') diagnostics.push(message.text()) })
    page.on('requestfailed', request => diagnostics.push(`${new URL(request.url()).pathname}: ${request.failure()?.errorText}`))
  })
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url())
    if (url.origin === origin) {
      // Mirror the checked-in Vercel rewrites for this static preview.
      const path = url.pathname === '/studio' ? '/studio.html'
        : ['/reports', '/share', '/machines', '/evaluations'].includes(url.pathname) ? '/reports.html'
        : url.pathname === '/login' ? '/index.html' : url.pathname
      const response = await route.fetch({ url: new URL(path + url.search, local).href })
      return route.fulfill({ response })
    }
    if (onboarding && url.origin === accountStorage) {
      const headers = { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'content-type, authorization, convex-client', 'access-control-allow-methods': 'POST, OPTIONS' }
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
      assert.match(request.headers().authorization, /^Bearer /)
      const body = request.postDataJSON()
      assert.ok(['onboarding:get', 'onboarding:save'].includes(body.path), 'Only onboarding storage is simulated')
      if (body.path === 'onboarding:save') {
        const next = body.args[0] as GuideProgress
        if (guideProgress?.status !== 'completed' && (guideProgress?.status !== 'skipped' || next.status === 'completed')) guideProgress = next
      }
      return route.fulfill({ headers, json: { status: 'success', value: guideProgress } })
    }
    // Block all services except the isolated authentication/storage simulations.
    if (url.hostname !== 'api.workos.com') return route.abort()
    if (url.pathname.endsWith('/authorize')) {
      stats.authorizations++
      diagnostics.push('Authorization started')
      assert.equal(url.searchParams.get('client_id'), clientId)
      assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
      challenge = url.searchParams.get('code_challenge')!
      const callback = new URL(url.searchParams.get('redirect_uri')!)
      assert.equal(callback.origin, origin)
      callback.searchParams.set('code', 'test-authorization-code')
      const state = url.searchParams.get('state')
      if (state) callback.searchParams.set('state', state)
      // A fresh navigation keeps the callback inside Playwright routing (a
      // fulfilled 302 bypasses routing for the redirect target).
      return route.fulfill({ contentType: 'text/html', body: `<script>location.replace(${JSON.stringify(callback.href)})</script>` })
    }
    if (url.pathname.endsWith('/sessions/logout')) {
      return route.fulfill({ contentType: 'text/html', body: `<script>location.replace(${JSON.stringify(`${origin}/studio`)})</script>` })
    }
    if (!url.pathname.endsWith('/authenticate')) return route.abort()
    const headers = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST, OPTIONS' }
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    const body = request.postDataJSON()
    assert.equal(body.client_id, clientId)
    if (body.grant_type === 'authorization_code') {
      stats.exchanges++
      diagnostics.push('Authorization code exchanged')
      assert.equal(body.code, 'test-authorization-code')
      assert.equal(createHash('sha256').update(body.code_verifier).digest('base64url'), challenge)
    } else {
      stats.refreshes++
      diagnostics.push('Session refreshed')
      assert.equal(body.grant_type, 'refresh_token')
      assert.equal(body.refresh_token, refreshToken)
      if (stats.rejectRefresh) return route.fulfill({ status: 400, headers, json: { error: 'invalid_grant', error_description: 'Session ended' } })
    }
    refreshToken = `test-refresh-${stats.exchanges + stats.refreshes}`
    const now = Math.floor(Date.now() / 1000)
    const accessToken = [{ alg: 'RS256', typ: 'JWT' }, { sub: 'user_session_test', sid: 'session_test', iss: 'https://api.workos.com/', aud: clientId, iat: now, exp: now + 3600 }].map(value => Buffer.from(JSON.stringify(value)).toString('base64url')).join('.') + '.test-signature'
    return route.fulfill({ headers, json: {
      user: { id: 'user_session_test', email, email_verified: true, first_name: 'Session', last_name: 'Test', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
      access_token: accessToken, refresh_token: refreshToken, authentication_method: 'Password',
    } })
  })
  await context.routeWebSocket(/.*/, ws => ws.close())
  return { context, stats }
}
const contexts: BrowserContext[] = []
try {
  if (onboarding) {
    const flow = await session(); contexts.push(flow.context)
    const page = await flow.context.newPage()
    const editorRequests: string[] = []
    page.on('request', request => { if (request.url().includes('/assets/StudioWorkspace')) editorRequests.push(request.url()) })
    await page.goto(`${origin}/studio?job=${job}&recipe=scatter`)
    await page.getByRole('button', { name: 'Sign in to Studio', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Try the demo' })).toBeVisible()
    assert.deepEqual(editorRequests, [], 'First login must show onboarding before loading the editor')
    await page.getByRole('button', { name: 'Next', exact: true }).click()
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Check your setup' })).toBeVisible()
    await page.getByRole('button', { name: 'Next', exact: true }).click()
    await page.getByRole('button', { name: 'Next', exact: true }).click()
    await page.getByRole('button', { name: 'Open Studio', exact: true }).click()
    await expect(page.locator('.studio')).toBeVisible()
    await expect(page.locator('#f-recipe')).toHaveValue('scatter')
    await page.reload()
    await expect(page.locator('.studio')).toBeVisible()
    const reopened = flow.context.waitForEvent('page')
    await page.getByRole('link', { name: 'CLI guide', exact: true }).click()
    const guide = await reopened
    await expect(guide.getByRole('heading', { name: 'Try the demo' })).toBeVisible()
    await guide.getByRole('button', { name: 'Skip for now' }).click()
    await expect(guide.locator('.studio')).toBeVisible()
    await expect(guide.locator('#f-recipe')).toHaveValue('scatter')
    await expect(page.locator('.studio')).toBeVisible()
    await guide.close()
    assert.deepEqual(guideProgress, { step: 3, status: 'completed' })
    // A different browser has no local completion flag; account storage controls it.
    const other = await session(); contexts.push(other.context)
    const returning = await other.context.newPage()
    await returning.goto(`${origin}/studio`)
    await returning.getByRole('button', { name: 'Sign in to Studio', exact: true }).click()
    await expect(returning.locator('.studio')).toBeVisible()
    await expect(returning.getByRole('heading', { name: 'Try the demo' })).toHaveCount(0)
    assert.deepEqual(errors, [])
    console.log('PASS: real AuthKit callback → first-login guide → authenticated progress storage → resume → Studio → reopen → another browser skips the completed guide.')
  } else {
  const { context, stats } = await session(); contexts.push(context)
  const page = await context.newPage()
  const destinations: string[] = []
  page.on('framenavigated', frame => { if (frame === page.mainFrame()) destinations.push(frame.url()) })
  const path = `/studio?job=${job}&recipe=scatter&color=none#chart`
  await page.goto(origin + path)
  await page.getByRole('button', { name: 'Sign in to Studio', exact: true }).click()
  await expect(page.locator('.studio')).toBeVisible()
  await expect(page.locator('#f-recipe')).toHaveValue('scatter')
  await expect(page.locator('#f-color')).toHaveValue('none')
  assert.ok(destinations.filter(url => url === origin + path).length >= 2, 'Sign-in must return to the complete requested URL before Studio normalizes its chart state')
  assert.equal(stats.exchanges, 1)
  assert.ok(stats.refreshes >= 1, 'The destination must restore the session after the callback navigation')
  await page.reload()
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible()
  const another = await context.newPage()
  await another.goto(`${origin}/studio.html?job=${job}`)
  await expect(another.locator('.studio')).toBeVisible()
  await another.close()
  // Crossing the multi-page app must restore the same account too.
  await page.goto(origin)
  await expect(page.getByTitle(`Sign out ${email}`)).toBeVisible()
  await page.goto(`${origin}/reports`)
  await page.goto(`${origin}/studio?job=${job}`)
  await expect(page.locator('.studio')).toBeVisible()
  assert.equal(stats.authorizations, 1, 'Navigation/reload must not initiate login again')
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Sign in to Studio' })).toBeVisible()
  assert.equal(await page.evaluate(key => localStorage.getItem(key), tokenKey), null)
  await page.reload()
  await expect(page.locator('.studio')).toHaveCount(0)
  console.log('PASS: PKCE callback → Studio, restored account, chart destination, refresh rotation, reload, second tab, multi-page navigation, and sign-out.')

  for (const entry of ['/', '/login']) {
    const flow = await session({ width: 390, height: 844 }); contexts.push(flow.context)
    const tab = await flow.context.newPage()
    await tab.goto(origin + entry)
    if (entry === '/') await tab.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(tab.locator('.studio')).toBeVisible()
    assert.equal(new URL(tab.url()).pathname, '/studio')
    // Visiting /login with a valid session opens Studio without another OAuth flow.
    await tab.goto(`${origin}/login`)
    await expect(tab.locator('.studio')).toBeVisible()
    assert.equal(flow.stats.authorizations, 1)
    flow.stats.rejectRefresh = true
    await tab.reload()
    await expect(tab.getByRole('heading', { name: 'Sign in to Studio' })).toBeVisible()
    assert.equal(await tab.evaluate(key => localStorage.getItem(key), tokenKey), null)
  }
  console.log('PASS: homepage and /login default to Studio; existing accounts skip login; revoked sessions remain gated.')

  const reportFlow = await session(); contexts.push(reportFlow.context)
  const reportTab = await reportFlow.context.newPage()
  await reportTab.goto(`${origin}/studio?report=saved-report#draft`)
  await reportTab.getByRole('button', { name: 'Sign in to Studio', exact: true }).click()
  // Storage is deliberately disconnected in this test, but the authenticated
  // route must preserve the report link and load its provider, not the login wall.
  await expect(reportTab.getByRole('heading', { name: 'Saved reports are coming online' })).toBeVisible()
  assert.equal(new URL(reportTab.url()).search, '?report=saved-report')
  assert.equal(new URL(reportTab.url()).hash, '#draft')
  assert.deepEqual(errors, [])
  console.log('PASS: saved-report destination preserved; no browser exceptions. Report persistence is covered by test:reports.')
  }
} catch (error) {
  for (const context of contexts) for (const page of context.pages()) {
    console.error({ path: new URL(page.url()).pathname, screen: (await page.locator('body').innerText()).slice(0, 1500), errors, diagnostics })
  }
  throw error
} finally {
  await Promise.all(contexts.map(context => context.close()))
  await browser.close()
  await new Promise<void>((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()))
}
