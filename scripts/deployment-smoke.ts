import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { chromium, expect } from '@playwright/test'

const root = resolve(import.meta.dirname, '..')
const dist = join(root, 'dist')
const temporary = await mkdtemp(join(tmpdir(), 'heval-deployment-'))
const env = { ...process.env, VITE_WORKOS_CLIENT_ID: '', VITE_CONVEX_URL: '', WORKOS_CLIENT_ID: '', HEVAL_ENABLE_RUNNER: '0', HEVAL_ENABLE_EXPORTS: '0' }
const browser = await chromium.launch()
let staticServer: ReturnType<typeof Bun.serve> | undefined
let backend: Bun.Subprocess<'ignore', 'pipe', 'pipe'> | undefined

async function build(script: string) {
  const process = Bun.spawn(['bun', 'run', script], { cwd: root, env, stdout: 'inherit', stderr: 'inherit' })
  assert.equal(await process.exited, 0, `${script} failed`)
}

try {
  await build('build:showcase')
  const routes = JSON.parse(await readFile(join(root, 'vercel.json'), 'utf8')).rewrites as { source: string; destination: string }[]
  const apiRequests: string[] = []
  staticServer = Bun.serve({
    hostname: '127.0.0.1', port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname
      if (path.startsWith('/api/')) apiRequests.push(path)
      const file = resolve(dist, '.' + (routes.find(route => route.source === path)?.destination ?? path))
      if (!file.startsWith(dist + sep)) return new Response('Not found', { status: 404 })
      return await Bun.file(file).exists() ? new Response(Bun.file(file)) : new Response('Not found', { status: 404 })
    },
  })
  const page = await browser.newPage()
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(String(staticServer.url))
  await expect(page.getByRole('heading', { name: 'The open-source evaluation platform for coding agents.' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'RUN REAL' })).toHaveCount(0)
  await expect(page.getByPlaceholder('you@company.com')).toHaveCount(0)
  await page.getByRole('link', { name: 'Create an evaluation', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Evaluations are coming online' })).toBeVisible()
  await page.goto(new URL('/studio?job=demo-evaluation&recipe=bar&x=modelShort&color=none&measure=passed', staticServer.url).href)
  await expect(page.getByRole('heading', { name: 'Sign in to Studio' })).toBeVisible()
  await expect(page.getByRole('status')).toContainText('Sign-in isn’t available')
  await expect(page.locator('.studio')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Open export' })).toHaveCount(0)
  await page.goto(new URL('/studio.html?report=private-report', staticServer.url).href)
  await expect(page.getByRole('heading', { name: 'Sign in to Studio' })).toBeVisible()
  assert.equal(await Bun.file(join(dist, 'tests/fixtures/studio-auth.html')).exists(), false)
  assert.equal(await Bun.file(join(dist, 'tests/fixtures/onboarding.html')).exists(), false)
  await page.goto(new URL('/login', staticServer.url).href)
  await expect(page.getByRole('heading', { name: 'The open-source evaluation platform for coding agents.' })).toBeVisible()
  await page.setViewportSize({ width: 393, height: 851 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false)
  assert.deepEqual(apiRequests, [], 'The static deployment must not depend on Bun APIs')
  staticServer.stop(true)
  staticServer = undefined
  console.log('PASS: Vercel routes, Studio auth gate, and mobile layout without a backend.')

  await build('build:public')
  const published = JSON.parse(await readFile(join(root, 'results/public/index.json'), 'utf8'))
  assert.deepEqual(JSON.parse(await readFile(join(dist, 'results/harbor/index.json'), 'utf8')), published)
  assert.equal(await Bun.file(join(dist, 'public-build.json')).exists(), true)
  assert.equal(await Bun.file(join(dist, 'results/harbor/demo-evaluation.json')).exists(), false)
  assert.equal(await Bun.file(join(dist, 'tests/fixtures/workbench.html')).exists(), false)
  for (const asset of await readdir(join(dist, 'assets'))) {
    if (!asset.endsWith('.js')) continue
    const text = await readFile(join(dist, 'assets', asset), 'utf8')
    assert.doesNotMatch(text, /demo-evaluation|browser-test-token/, `${asset} contains private or test fixtures`)
  }
  backend = Bun.spawn(['bun', 'server/index.ts'], {
    cwd: root,
    env: { ...env, HOST: '127.0.0.1', PORT: '0', HEVAL_DATA_DIR: temporary, HEVAL_HOSTED: '1',
      HEVAL_PUBLIC_ORIGIN: 'https://heval.example.invalid', HEVAL_CONNECTION_ENCRYPTION_KEY: 'ab'.repeat(32) },
    stdin: 'ignore', stdout: 'pipe', stderr: 'pipe',
  })
  const process = backend
  const output = await Promise.race([
    (async () => {
      let text = ''
      const reader = process.stdout.getReader()
      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          text += new TextDecoder().decode(value)
          const match = text.match(/http:\/\/127\.0\.0\.1:\d+/)
          if (match) return match[0]
        }
      } finally { reader.releaseLock() }
      throw new Error(`Bun server failed: ${await new Response(process.stderr).text()}`)
    })(),
    new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(new Error('Bun server startup timed out')), 15000); timer.unref() }),
  ])
  assert.equal((await (await fetch(`${output}/api/health`)).json()).runnerEnabled, false)
  assert.equal((await fetch(`${output}/api/runs`)).status, 401)
  await page.goto(output)
  await expect(page.getByRole('heading', { name: 'Show the work. Then compare.' })).toBeVisible()
  await page.getByRole('link', { name: 'Report library', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Saved reports are coming online' })).toBeVisible()
  await page.goto(output)
  await page.getByRole('link', { name: 'Explore public results' }).click()
  await expect(page.getByRole('heading', { name: 'Sign in to Studio' })).toBeVisible()
  await expect(page.getByRole('status')).toContainText('Sign-in isn’t available')
  await expect(page.locator('.studio')).toHaveCount(0)
  assert.deepEqual(errors, [])
  console.log('PASS: public build excludes comparison/test fixtures; Bun serves the app and protects saved runs.')
} finally {
  await browser.close()
  staticServer?.stop(true)
  if (backend && backend.exitCode === null) { backend.kill('SIGTERM'); await backend.exited }
  await rm(temporary, { recursive: true, force: true })
}
