/** Full browser flow against an isolated cloud preview. Only WorkOS is replaced
 * with short-lived signed test identities; production auth config is untouched.
 * HEVAL_SMOKE_ENV points to an ignored env file containing a PREVIEW deploy key.
 * HEVAL_SMOKE_URL points to that preview's convex.cloud URL. Never use production.
 */
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { generateKeyPair, exportJWK, SignJWT } from 'jose'
import { createServer } from 'vite'
import { chromium, expect, type Page } from '@playwright/test'
import { ConvexHttpClient } from 'convex/browser'
import { api } from '../convex/_generated/api'

const root = resolve(import.meta.dirname, '..')
const envFile = process.env.HEVAL_SMOKE_ENV
const url = process.env.HEVAL_SMOKE_URL
if (!envFile || !url) throw new Error('Set HEVAL_SMOKE_ENV and HEVAL_SMOKE_URL for an isolated preview deployment.')
const key = (await readFile(envFile, 'utf8')).match(/^CONVEX_DEPLOY_KEY=["']?([^"'\s]+)/m)?.[1]
// Convex's deployment-scoped keys use the dev: prefix for preview deployments too.
if (!key?.startsWith('dev:') || !url.endsWith('.convex.cloud') || !key.split('|')[0].includes(new URL(url).hostname.split('.')[0])) throw new Error('Smoke tests require a non-production deployment key matching the cloud URL.')
await mkdir(resolve(root, '.scratch'), { recursive: true })
const temporary = await mkdtemp(resolve(root, '.scratch/report-smoke-'))
const evidence = resolve(root, 'recordings/hosted-report-flow')
await mkdir(evidence, { recursive: true })
const { publicKey, privateKey } = await generateKeyPair('RS256')
const jwk = { ...await exportJWK(publicKey), kid: 'smoke', alg: 'RS256', use: 'sig' }
const issuer = 'https://heval-smoke.invalid'
const jwt = async (subject: string) => new SignJWT({ email: `${subject}@example.invalid` }).setProtectedHeader({ alg: 'RS256', kid: 'smoke', typ: 'JWT' }).setSubject(subject).setIssuer(issuer).setAudience('heval-smoke').setIssuedAt().setExpirationTime('1h').sign(privateKey)
const ownerToken = await jwt(`smoke-owner-${Date.now()}`)
const otherToken = await jwt(`smoke-other-${Date.now()}`)
await mkdir(resolve(temporary, 'src/reports'), { recursive: true })
await mkdir(resolve(temporary, 'src/charts'), { recursive: true })
await cp(resolve(root, 'convex'), resolve(temporary, 'convex'), { recursive: true })
await mkdir(resolve(temporary, 'server/hosted-exports'), { recursive: true })
await cp(resolve(root, 'server/hosted-exports/render.ts'), resolve(temporary, 'server/hosted-exports/render.ts'))
for (const test of new Bun.Glob('*.test.ts').scanSync(resolve(temporary, 'convex'))) await rm(resolve(temporary, 'convex', test))
await cp(resolve(root, 'src'), resolve(temporary, 'src'), { recursive: true })
await symlink(resolve(root, 'node_modules'), resolve(temporary, 'node_modules'))
await writeFile(resolve(temporary, 'package.json'), JSON.stringify({ type: 'module', dependencies: { convex: '^1.45.0', '@vercel/sandbox': '3.3.0', '@vercel/blob': '2.8.0' } }))
await writeFile(resolve(temporary, 'convex/auth.config.ts'), `export default ${JSON.stringify({ providers: [{ type: 'customJwt', issuer, applicationID: 'heval-smoke', algorithm: 'RS256', jwks: `data:text/plain;charset=utf-8;base64,${Buffer.from(JSON.stringify({ keys: [jwk] })).toString('base64')}` }] })}`)
const deploy = Bun.spawn(['bunx', 'convex', 'deploy', '-y'], { cwd: temporary, env: { ...process.env, CONVEX_DEPLOY_KEY: key, CONVEX_DEPLOYMENT: undefined }, stdout: 'pipe', stderr: 'pipe' })
const output = await new Response(deploy.stderr).text()
if (await deploy.exited) throw new Error(output.replaceAll(key, '[redacted]'))
console.log('Deployed real report functions to isolated cloud preview.')
process.env.VITE_CONVEX_URL = url
const server = await createServer({ root, server: { host: '127.0.0.1', port: 5337, strictPort: true }, plugins: [{
  name: 'report-smoke-identity', enforce: 'pre',
  resolveId(source, importer) { if (source === '../AuthBoundary' && (importer?.endsWith('/src/reports/main.tsx') || importer?.endsWith('/src/studio/main.tsx'))) return '\0report-smoke-auth' },
  load(id) {
    if (id !== '\0report-smoke-auth') return
    return `import React from 'react'; import {AuthContext,publicAuth} from '/src/auth.ts';
      const role = sessionStorage.getItem('smoke-role');
      const signedIn = location.pathname !== '/share' && (role === 'owner' || role === 'other');
      const auth = {...publicAuth, configured:true, user:signedIn?{email:role+'@example.invalid'}:null,
        signIn(){sessionStorage.setItem('smoke-role','owner');location.reload()},
        signOut(){sessionStorage.removeItem('smoke-role');location.assign('/reports')},
        async getAccessToken(){return signedIn ? (role==='other'?${JSON.stringify(otherToken)}:${JSON.stringify(ownerToken)}) : undefined}};
      export function AuthBoundary({children}) {return React.createElement(AuthContext.Provider,{value:auth},children(auth))}`
  },
}] })
await server.listen()
const browser = await chromium.launch()
const owner = await browser.newContext({ viewport: { width: 1366, height: 900 }, recordVideo: { dir: evidence, size: { width: 1366, height: 900 } }, permissions: ['clipboard-read', 'clipboard-write'] })
const guest = await browser.newContext({ viewport: { width: 1366, height: 900 } })
const another = await browser.newContext()
const errors: string[] = []
const page = await owner.newPage()
const viewer = await guest.newPage()
for (const p of [page, viewer]) p.on('pageerror', error => errors.push(error.message))
const events: { step: string; seconds: number }[] = []
const start = Date.now()
async function chapter(p: Page, text: string) {
  events.push({ step: text, seconds: Math.round((Date.now() - start) / 1000) })
  await p.evaluate(text => {
    document.getElementById('smoke-caption')?.remove()
    const caption = document.createElement('div'); caption.id = 'smoke-caption'; caption.textContent = text
    Object.assign(caption.style, { position: 'fixed', bottom: '16px', right: '16px', zIndex: '9999', background: '#203a2b', color: 'white', padding: '14px 22px', borderRadius: '9px', font: '15px sans-serif', maxWidth: '85vw' }); document.body.append(caption)
  }, text)
  await p.waitForTimeout(1500)
}
try {
  await page.goto('http://127.0.0.1:5337/reports')
  await expect(page.getByRole('button', { name: 'Sign in to your workspace' })).toBeVisible()
  await chapter(page, '1 · Sign in to your workspace (test identity for this recording)')
  await page.getByRole('button', { name: 'Sign in to your workspace' }).click()
  await expect(page.getByRole('heading', { name: 'Import evaluation results' })).toBeVisible()
  await page.getByLabel('Choose Harbor JSON', { exact: true }).setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{}') })
  await expect(page.getByRole('alert')).toContainText('normalized Harbor')
  await page.getByLabel('Choose Harbor JSON', { exact: true }).setInputFiles(resolve(root, 'results/harbor/terminal-bench-comparison.json'))
  await page.getByLabel('Report title', { exact: true }).fill('Terminal Bench · team review')
  await chapter(page, '2 · Import Harbor JSON and review exactly what will be saved')
  await page.screenshot({ path: resolve(evidence, '01-import.png'), fullPage: true })
  await page.getByRole('button', { name: 'Save private report' }).click()
  await expect(page.getByText('Public link off', { exact: true })).toBeVisible()
  const savedUrl = page.url()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Terminal Bench · team review' })).toBeVisible()
  await expect(page.locator('.report-chart svg')).toBeVisible()
  await chapter(page, '3 · Saved privately in Convex — survives a page reload')
  await page.screenshot({ path: resolve(evidence, '02-saved.png'), fullPage: true })
  await viewer.goto(savedUrl)
  await expect(viewer.getByRole('button', { name: 'Sign in to your workspace' })).toBeVisible()
  const outsider = await another.newPage()
  await outsider.addInitScript(() => sessionStorage.setItem('smoke-role', 'other'))
  await outsider.goto(savedUrl)
  await expect(outsider.getByRole('heading', { name: 'Report not found' })).toBeVisible()
  await page.getByRole('button', { name: 'Create share link' }).click()
  await expect(page.getByLabel('Share link', { exact: true })).toBeVisible()
  const link = await page.getByLabel('Share link', { exact: true }).inputValue()
  await page.getByRole('button', { name: 'Copy link', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('Link copied.')
  await chapter(page, '4 · Create and copy a link — anyone with it can view this report')
  await page.screenshot({ path: resolve(evidence, '03-share.png'), fullPage: true })
  await viewer.goto(link)
  await expect(viewer.getByRole('heading', { name: 'Terminal Bench · team review' })).toBeVisible()
  await expect(viewer.locator('.report-chart svg')).toBeVisible()
  await expect(viewer.getByRole('button', { name: 'Revoke link', exact: true })).toHaveCount(0)
  // Show the same anonymous experience in the recorded tab, then return to owner controls.
  await page.goto(link)
  await expect(page.getByText('Shared report · Read only · No sign-in required')).toBeVisible()
  await chapter(page, '5 · Recipient opens the full report without signing in')
  await page.getByLabel('Model', { exact: true }).selectOption({ index: 1 })
  await page.getByText(/Inspect \d+ trial results/).click()
  await page.screenshot({ path: resolve(evidence, '04-recipient.png'), fullPage: true })
  await page.waitForTimeout(1800)
  await page.goto(savedUrl)
  await page.getByRole('button', { name: 'Revoke link', exact: true }).click()
  await chapter(page, '6 · Revoke access — the saved report stays in your workspace')
  await page.getByRole('button', { name: 'Yes, revoke link' }).click()
  await expect(page.getByRole('status')).toHaveText('Link revoked. Your report is still saved.')
  // Already-open viewers must lose access without refreshing.
  await expect(viewer.getByRole('heading', { name: 'This link is unavailable' })).toBeVisible()
  await expect(viewer.locator('.report-chart')).toHaveCount(0)
  await page.goto(link)
  await expect(page.getByRole('heading', { name: 'This link is unavailable' })).toBeVisible()
  await chapter(page, '7 · The old link stops working, including for an already-open viewer')
  await page.screenshot({ path: resolve(evidence, '05-revoked.png'), fullPage: true })
  await page.goto(savedUrl)
  await page.getByRole('button', { name: 'Create share link' }).click()
  const newLink = await page.getByLabel('Share link', { exact: true }).inputValue()
  expect(newLink).not.toBe(link)
  await viewer.reload()
  await expect(viewer.getByRole('heading', { name: 'This link is unavailable' })).toBeVisible()
  await viewer.goto(newLink)
  await expect(viewer.getByRole('heading', { name: 'Terminal Bench · team review' })).toBeVisible()
  await page.getByRole('button', { name: 'Revoke link', exact: true }).click()
  await page.getByRole('button', { name: 'Yes, revoke link' }).click()
  await page.goto('http://127.0.0.1:5337/reports')
  await expect(page.getByRole('link', { name: /Terminal Bench · team review/ })).toBeVisible()
  await chapter(page, '8 · Find it again in Your saved reports; create a fresh link whenever needed')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: resolve(evidence, '06-mobile.png'), fullPage: true })
  const overflow = await page.evaluate(() => [...document.querySelectorAll('*')].filter(el => el.getBoundingClientRect().right > innerWidth + 1).map(el => ({ tag: el.tagName, class: el.className })))
  expect(overflow).toEqual([])
  const anonymous = new ConvexHttpClient(url)
  await expect(anonymous.mutation(api.reports.save, { json: '{}', title: 'unauthorized' })).rejects.toThrow('Sign in')
  expect(errors).toEqual([])
  await writeFile(resolve(evidence, 'smoke-result.json'), JSON.stringify({ passed: true, backend: url, identity: 'Ephemeral signed test JWT; WorkOS login UI not exercised', events, checks: ['invalid import', 'private save', 'reload persistence', 'anonymous owner-page denial', 'other-account denial', 'copy link', 'anonymous shared view', 'filters and trial table', 'live revocation', 'fresh-visit revocation', 'new token after revoke', 'old link stays revoked', 'mobile overflow', 'unauthenticated mutation denial', 'no browser exceptions'] }, null, 2))
  console.log('PASS: hosted import → saved report → share → revoke; 15 checks.')
} finally {
  await owner.close(); await guest.close(); await another.close(); await browser.close(); await server.close()
  const video = await page.video()?.path()
  if (video) await cp(video, resolve(evidence, 'walkthrough.webm'))
  await rm(temporary, { recursive: true, force: true })
}
