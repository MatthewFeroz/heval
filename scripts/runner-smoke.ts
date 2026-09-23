import { HARBOR_VERSION } from '../packages/cli/src/harbor-version'
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
import { connectRunner } from '../packages/cli/src/runner/client'
import { randomSecret } from '../packages/cli/src/runner/files'
import type { Id } from '../convex/_generated/dataModel'

const root = resolve(import.meta.dirname, '..')
const envFile = process.env.HEVAL_SMOKE_ENV
const url = process.env.HEVAL_SMOKE_URL
if (!envFile || !url) throw new Error('Set HEVAL_SMOKE_ENV and HEVAL_SMOKE_URL for an isolated preview deployment.')
const key = (await readFile(envFile, 'utf8')).match(/^CONVEX_DEPLOY_KEY=["']?([^"'\s]+)/m)?.[1]
// Convex's deployment-scoped keys use the dev: prefix for preview deployments too.
if (!key?.startsWith('dev:') || !url.endsWith('.convex.cloud') || !key.split('|')[0].includes(new URL(url).hostname.split('.')[0])) throw new Error('Smoke tests require a non-production deployment key matching the cloud URL.')
await mkdir(resolve(root, '.scratch'), { recursive: true })
const temporary = await mkdtemp(resolve(root, '.scratch/runner-smoke-'))
const evidence = resolve(root, 'recordings/connected-runner-flow')
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
console.log('Deployed real runner functions to isolated cloud preview.')
process.env.VITE_CONVEX_URL = url
const server = await createServer({ root, server: { host: '127.0.0.1', port: 5338, strictPort: true }, plugins: [{
  name: 'runner-smoke-identity', enforce: 'pre',
  resolveId(source, importer) { if (source === '../AuthBoundary' && (importer?.endsWith('/src/reports/main.tsx') || importer?.endsWith('/src/studio/main.tsx'))) return '\0runner-smoke-auth' },
  load(id) {
    if (id !== '\0runner-smoke-auth') return
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
const owner = await browser.newContext({ viewport: { width: 1366, height: 1000 }, recordVideo: { dir: evidence }, permissions: ['clipboard-read', 'clipboard-write'] })
const second = await browser.newContext({ viewport: { width: 1366, height: 1000 } })
const outsider = await browser.newContext()
await owner.addInitScript(() => sessionStorage.setItem('smoke-role', 'owner'))
await second.addInitScript(() => sessionStorage.setItem('smoke-role', 'owner'))
await outsider.addInitScript(() => sessionStorage.setItem('smoke-role', 'other'))
const page = await owner.newPage(), otherPage = await second.newPage(), forbidden = await outsider.newPage()
const ownerApi = new ConvexHttpClient(url); ownerApi.setAuth(ownerToken)
const otherApi = new ConvexHttpClient(url); otherApi.setAuth(otherToken)
const events: { step: string; seconds: number }[] = [], errors: string[] = []
for (const p of [page, otherPage, forbidden]) p.on('pageerror', e => errors.push(e.message))
const start = Date.now(), origin = 'http://127.0.0.1:5338'
const states = [resolve(temporary, 'machine-a'), resolve(temporary, 'machine-b')]
const harbor = process.env.HEVAL_SMOKE_HARBOR ?? resolve(root, '.scratch/harbor-runner-venv/bin/harbor')
type Daemon = ReturnType<typeof Bun.spawn>
const daemons: Daemon[] = []
const logs: Promise<void>[] = []
const machineIds: Id<'runners'>[] = []
const runIds: Id<'runnerRuns'>[] = []
async function chapter(p: Page, text: string) {
  events.push({ step: text, seconds: Math.round((Date.now() - start) / 1000) })
  console.log(text)
  await p.evaluate(text => {
    document.getElementById('smoke-caption')?.remove()
    const caption = document.createElement('div'); caption.id = 'smoke-caption'; caption.textContent = text
    Object.assign(caption.style, { position: 'fixed', bottom: '16px', right: '16px', zIndex: '9999', background: '#203a2b', color: 'white', padding: '14px 22px', borderRadius: '9px', font: '15px sans-serif', maxWidth: '85vw' }); document.body.append(caption)
  }, text)
  await p.waitForTimeout(800)
}
function daemon(index: number) {
  const child = Bun.spawn(['node', resolve(root, 'packages/cli/dist/cli.js'), 'runner', 'start', '--state', states[index], '--harbor', harbor], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
  daemons.push(child)
  logs.push(Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]).then(([out, err]) => writeFile(resolve(evidence, `machine-${index}-${child.pid}.log`), out + '\n' + err)))
  return child
}
async function queue(index: number) {
  const machine = (await ownerApi.query(api.runners.list)).find(m => m.id === machineIds[index])!
  const profile = machine.profiles[0]
  const id = await ownerApi.mutation(api.runners.enqueue, { runner: machine.id, profileId: profile.id, digest: profile.digest, requestId: randomSecret() })
  runIds.push(id); return id
}
async function status(id: Id<'runnerRuns'>) { return (await ownerApi.query(api.runners.runs)).find(r => r.id === id)?.status }
try {
  await page.goto(`${origin}/machines`)
  await expect(page.getByRole('heading', { name: 'Connect the machine. Run from Evaluations.' })).toBeVisible()
  for (const [i, name] of ['Linux workstation', 'Cloud runner'].entries()) {
    await page.getByLabel('Machine name').fill(name)
    await page.getByRole('button', { name: 'Create pairing code' }).click()
    const codeField = page.getByLabel('One-time pairing code')
    await expect(codeField).toBeVisible()
    await expect(page.getByRole('status')).toContainText('Pairing code ready')
    const code = await codeField.inputValue()
    const paired = await connectRunner(states[i], url, code, resolve(root, 'packages/cli/dist/runner-task'))
    machineIds.push(paired.id)
    await page.reload()
    await expect(page.getByRole('region', { name: 'Connected machines' }).getByText(name, { exact: true })).toBeVisible()
  }
  const firstDaemon = daemon(0); daemon(1)
  await expect.poll(async () => (await ownerApi.query(api.runners.list)).filter(m => m.ready).length, { timeout: 90_000 }).toBe(2)
  const machines = await ownerApi.query(api.runners.list)
  expect(machines[0].profiles[0].digest).toBe(machines[1].profiles[0].digest)
  await chapter(page, '1 · Two independently paired machines; outbound connections, no forwarded ports')
  await page.screenshot({ path: resolve(evidence, '01-machines.png'), fullPage: true })
  await page.getByLabel('Run on', { exact: true }).selectOption(machineIds[0])
  await page.getByRole('button', { name: 'Run setup check' }).click()
  await expect(page.getByRole('status')).toContainText('Setup check queued')
  const first = (await ownerApi.query(api.runners.runs))[0].id; runIds.push(first)
  await expect.poll(() => status(first), { timeout: 20_000 }).toBe('running')
  await chapter(page, '2 · Browser dispatches one real Harbor + Docker setup task, with no model calls')
  // A second queued job moves to B while A owns the original claim.
  const moved = await queue(0)
  await page.locator(`[data-run-id="${moved}"]`).getByLabel('Move queued evaluation').selectOption(machineIds[1])
  await expect.poll(() => status(moved), { timeout: 20_000 }).toBe('running')
  firstDaemon.kill('SIGKILL'); await firstDaemon.exited
  await otherPage.goto(`${origin}/machines`)
  await expect(otherPage.locator(`[data-run-id="${first}"]`)).toBeVisible()
  await chapter(page, '3 · Queued work moves to the cloud runner; another browser sees the same active evaluation')
  await forbidden.goto(`${origin}/machines`)
  await expect(forbidden.getByText('No connected machines yet. Create a pairing code above.')).toBeVisible()
  await expect(otherApi.mutation(api.runners.cancel, { id: first })).rejects.toThrow('not found')
  // Let A finish locally while its daemon is dead. No claim may move or repeat.
  await expect.poll(async () => Bun.file(resolve(states[0], 'runs', first, 'outcome.json')).exists(), { timeout: 120_000 }).toBe(true)
  const localOutcome = await Bun.file(resolve(states[0], 'runs', first, 'outcome.json')).json()
  expect(localOutcome.status).toBe('completed')
  expect(await status(first)).toBe('running')
  await expect.poll(() => status(moved), { timeout: 120_000 }).toBe('completed')
  await chapter(page, '4 · Killing the polling daemon does not kill Harbor; results wait safely on disk')
  daemon(0)
  await expect.poll(() => status(first), { timeout: 90_000 }).toBe('completed')
  await expect(otherPage.locator(`[data-run-id="${first}"]`).getByRole('link', { name: 'Open saved report' })).toBeVisible()
  await chapter(page, '5 · Restarting the daemon uploads the existing result once, without rerunning the task')
  const firstRun = (await ownerApi.query(api.runners.runs)).find(r => r.id === first)!
  await page.goto(`${origin}/reports?id=${firstRun.report}`)
  await expect(page.locator('.report-chart svg')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Check this machine', exact: true })).toBeVisible()
  await chapter(page, '6 · Harbor results arrive as a private report, ready for Studio and sharing')
  await page.screenshot({ path: resolve(evidence, '02-result.png'), fullPage: true })
  // Exercise the previously pending hosted editor flow on the new result.
  await page.getByRole('link', { name: 'Edit chart in Studio' }).click()
  await expect(page.locator('#f-title')).toBeVisible()
  await page.locator('#f-title').fill('Connected runner setup passed')
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Draft saved online')
  await page.getByRole('link', { name: 'View report', exact: true }).click()
  await page.getByRole('button', { name: 'Create share link', exact: true }).click()
  await expect(page.getByLabel('Share link', { exact: true })).toBeVisible()
  const shared = await page.getByLabel('Share link', { exact: true }).inputValue()
  await otherPage.goto(shared)
  await expect(otherPage.locator('.report-chart svg')).toContainText('Connected runner setup passed')
  await page.getByRole('button', { name: 'Revoke link', exact: true }).click()
  await page.getByRole('button', { name: 'Yes, revoke link', exact: true }).click()
  await expect(otherPage.getByRole('heading', { name: 'This link is unavailable' })).toBeVisible()
  await page.goto(`${origin}/machines`)
  const cancelled = await queue(1)
  await expect.poll(() => status(cancelled), { timeout: 20_000 }).toBe('running')
  await page.locator(`[data-run-id="${cancelled}"]`).getByRole('button', { name: 'Cancel evaluation' }).click()
  await expect.poll(() => status(cancelled), { timeout: 90_000 }).toBe('cancelled')
  await chapter(page, '7 · Stop requests wait for the machine’s cleanup acknowledgment')
  await ownerApi.mutation(api.runners.revoke, { id: machineIds[1] })
  await expect(page.getByRole('region', { name: 'Connected machines' }).getByText('Cloud runner', { exact: true })).toHaveCount(0)
  await chapter(page, '8 · Disconnecting a runner revokes its credential; saved reports remain')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: resolve(evidence, '03-mobile.png'), fullPage: true })
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  expect(errors).toEqual([])
  await writeFile(resolve(evidence, 'smoke-result.json'), JSON.stringify({ passed: true, backend: url, harbor: HARBOR_VERSION, physicalHosts: 1, runnerInstances: 2, browserSessions: 3, modelCalls: 0, identity: 'Isolated signed test JWT; real WorkOS login not exercised', events, checks: ['pairing', 'machine-independent profile digest', 'real Harbor and Docker execution', 'move queued evaluation', 'cross-session history', 'cross-account denial', 'daemon crash leaves supervisor running', 'restart uploads existing outcome', 'private saved report', 'hosted Studio save', 'shared chart matches editor', 'live share revocation', 'cooperative cancellation', 'runner revocation', 'mobile layout', 'no browser exceptions'] }, null, 2))
  console.log('PASS: connected Harbor runners; 16 end-to-end checks.')
} finally {
  // Preserve local output for diagnosis; stop only this test's work and credentials.
  for (const id of runIds) await ownerApi.mutation(api.runners.cancel, { id }).catch(() => {})
  for (const state of states) for (const id of runIds) { const dir = resolve(state, 'runs', id); if (await Bun.file(resolve(dir, 'execution.json')).exists()) await writeFile(resolve(dir, 'cancel'), '').catch(() => {}) }
  for (const child of daemons) if (child.exitCode === null) child.kill('SIGTERM')
  await Promise.all(daemons.map(p => p.exited)); await Promise.all(logs)
  for (const id of machineIds) await ownerApi.mutation(api.runners.revoke, { id }).catch(() => {})
  await owner.close(); await second.close(); await outsider.close(); await browser.close(); await server.close()
  const video = await page.video()?.path(); if (video) await cp(video, resolve(evidence, 'walkthrough.webm'))
  console.log(`Local runner evidence retained in ${temporary}`)
}
