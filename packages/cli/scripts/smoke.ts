import { strict as assert } from 'node:assert'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const { name, version } = JSON.parse(readFileSync(join(root, 'packages/cli/package.json'), 'utf8')) as { name: string; version: string }
const tarball = join(root, '.scratch', `${name.replace(/^@/, '').replace('/', '-')}-${version}.tgz`)
const temporary = mkdtempSync(join(tmpdir(), 'heval-package-smoke-'))
const node = realpathSync(Bun.which('node')!)
const npm = realpathSync(Bun.which('npm')!)
let child: ReturnType<typeof spawn> | undefined
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined

try {
  writeFileSync(join(temporary, 'package.json'), JSON.stringify({ private: true }))
  execFileSync(npm, ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', tarball], { cwd: temporary, stdio: 'pipe' })
  const installed = join(temporary, 'node_modules', name)
  const manifest = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'))
  assert.equal(manifest.bin.heval, 'dist/cli.js')
  assert.equal(manifest.dependencies, undefined)
  const assets = join(installed, 'dist/web/assets')
  for (const file of readdirSync(assets).filter(file => file.endsWith('.css'))) {
    assert.doesNotMatch(readFileSync(join(assets, file), 'utf8'), /fonts\.googleapis\.com/)
  }
  const cli = join(installed, manifest.bin.heval)
  assert.equal(execFileSync(node, [cli, '--version'], { cwd: temporary, encoding: 'utf8' }).trim(), version)
  // npm exec is the implementation behind npx; offline ensures no registry fallback.
  assert.equal(execFileSync(npm, ['exec', '--offline', '--no', '--', 'heval', '--version'], { cwd: temporary, encoding: 'utf8' }).trim(), version)
  assert.equal(execFileSync(npm, ['exec', '--offline', '--no', '--', name, '--version'], { cwd: temporary, encoding: 'utf8' }).trim(), version)
  assert.match(execFileSync(node, [cli], { cwd: temporary, encoding: 'utf8' }), /Start with: heval open/)
  assert.throws(() => execFileSync(node, [cli, 'run'], { cwd: temporary, stdio: 'pipe' }), /Command failed/)

  // Strip Bun, Harbor, Docker, and the repository from PATH for runtime checks.
  const nodeOnly = join(temporary, 'node-only')
  mkdirSync(nodeOnly)
  symlinkSync(node, join(nodeOnly, 'node'))
  const env = { ...process.env, PATH: nodeOnly }
  const checks = JSON.parse(execFileSync(node, [cli, 'doctor', '--json'], { cwd: temporary, env, encoding: 'utf8' }))
  assert.equal(checks.viewerReady, true)
  assert.equal(checks.evaluationToolsReady, false)
  assert.throws(() => execFileSync(node, [cli, 'doctor', '--strict'], { cwd: temporary, env, stdio: 'pipe' }), /Command failed/)

  child = spawn(node, [cli, 'open', '--no-browser'], { cwd: temporary, env, stdio: ['ignore', 'pipe', 'pipe'] })
  const url = await new Promise<string>((done, fail) => {
    let output = ''
    let errors = ''
    const timer = setTimeout(() => fail(new Error('Viewer did not start: ' + errors)), 15000)
    child!.stderr!.on('data', chunk => { errors += chunk })
    child!.stdout!.on('data', chunk => {
      output += chunk
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+\/studio\?\S+/)
      if (match) { clearTimeout(timer); done(match[0]) }
    })
    child!.once('error', error => { clearTimeout(timer); fail(error) })
    child!.once('exit', code => { clearTimeout(timer); fail(new Error(`Viewer exited (${code}): ${errors}`)) })
  })
  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort())
  await page.goto(url)
  await page.locator('.vega-embed svg').waitFor()
  assert.equal(await page.locator('.card svg .mark-rect.role-mark path').count(), 6)
  assert.equal(await page.getByRole('note').count(), 1)
  await page.screenshot({ path: join(root, '.scratch/heval-cli.png') })
  for (const label of ['SVG', 'PNG @2x', 'Bundle']) {
    const pending = page.waitForEvent('download')
    await page.getByRole('button', { name: label, exact: true }).click()
    const download = await pending
    assert.equal(await download.failure(), null)
    const content = readFileSync((await download.path())!)
    if (label === 'SVG') assert.match(content.toString(), /<svg/)
    if (label === 'PNG @2x') assert.equal(content.subarray(1, 4).toString(), 'PNG')
    if (label === 'Bundle') assert.equal(JSON.parse(content.toString()).artifactType, 'heval-bundle')
  }
  await page.getByRole('tab', { name: 'Presentation', exact: true }).click()
  await page.locator('.vega-embed svg').waitFor()
  assert.equal(await page.getByRole('tab', { name: 'Poster', exact: true }).getAttribute('aria-selected'), 'true')
  assert.equal(await page.getByRole('tab', { name: 'Social images', exact: true }).count(), 0)
  assert.equal(await page.getByRole('tab', { name: 'Motion', exact: true }).count(), 0)
  assert.equal(await page.getByRole('link', { name: 'Static report' }).count(), 0)
  assert.deepEqual(errors, [])
  console.log(`Packed ${name}@${version}: installed outside repo, npm exec, Node-only doctor/viewer, six-model chart, SVG/PNG/bundle downloads, and presentation passed.`)
} finally {
  await browser?.close()
  if (child && child.exitCode === null) {
    const stopped = new Promise<void>(done => child!.once('exit', () => done()))
    child.kill('SIGTERM')
    await stopped
  }
  rmSync(temporary, { recursive: true, force: true })
}
