import { strict as assert } from 'node:assert'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, expect } from '@playwright/test'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const { name, version } = JSON.parse(readFileSync(join(root, 'packages/cli/package.json'), 'utf8')) as { name: string; version: string }
const tarball = join(root, '.scratch', `${name.replace(/^@/, '').replace('/', '-')}-${version}.tgz`)
const temporary = mkdtempSync(join(tmpdir(), 'heval-package-smoke-'))
const node = realpathSync(Bun.which('node')!)
const npm = realpathSync(Bun.which('npm')!)
const fromRegistry = process.argv.includes('--registry')
const children: ReturnType<typeof spawn>[] = []
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined

async function launch(cli: string, args: string[], env: NodeJS.ProcessEnv) {
  const child = spawn(node, [cli, 'open', ...args, '--no-browser'], { cwd: temporary, env, stdio: ['ignore', 'pipe', 'pipe'] })
  children.push(child)
  return new Promise<string>((done, fail) => {
    let output = ''
    let errors = ''
    const timer = setTimeout(() => fail(new Error('Viewer did not start: ' + errors)), 15000)
    child.stderr!.on('data', chunk => { errors += chunk })
    child.stdout!.on('data', chunk => {
      output += chunk
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+\/studio\?\S+/)
      if (match) { clearTimeout(timer); done(match[0]) }
    })
    child.once('error', error => { clearTimeout(timer); fail(error) })
    child.once('exit', code => { clearTimeout(timer); fail(new Error(`Viewer exited (${code}): ${errors}`)) })
  })
}

try {
  writeFileSync(join(temporary, 'package.json'), JSON.stringify({ private: true }))
  const userconfig = join(temporary, 'empty.npmrc')
  writeFileSync(userconfig, '')
  const npmEnv = { ...process.env, npm_config_userconfig: userconfig, npm_config_cache: join(temporary, 'npm-cache') }
  execFileSync(npm, ['install', fromRegistry ? '--prefer-online' : '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', '--registry=https://registry.npmjs.org/', fromRegistry ? `${name}@${version}` : tarball], { cwd: temporary, env: npmEnv, stdio: 'pipe' })
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
  assert.equal(execFileSync(npm, ['exec', '--offline', '--no', '--', 'heval', '--version'], { cwd: temporary, env: npmEnv, encoding: 'utf8' }).trim(), version)
  assert.equal(execFileSync(npm, ['exec', '--offline', '--no', '--', name, '--version'], { cwd: temporary, env: npmEnv, encoding: 'utf8' }).trim(), version)
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

  const url = await launch(cli, [], env)
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
  console.log('PASS: fresh install, CLI version/help, missing-prerequisite checks, and six-model example.')
  let bundle: Buffer | undefined
  for (const label of ['SVG', 'PNG @2x', 'Bundle']) {
    const pending = page.waitForEvent('download')
    await page.getByRole('button', { name: label, exact: true }).click()
    const download = await pending
    assert.equal(await download.failure(), null)
    const content = readFileSync((await download.path())!)
    if (label === 'SVG') assert.match(content.toString(), /<svg/)
    if (label === 'PNG @2x') assert.equal(content.subarray(1, 4).toString(), 'PNG')
    if (label === 'Bundle') {
      assert.equal(JSON.parse(content.toString()).artifactType, 'heval-bundle')
      bundle = content
    }
  }
  console.log('PASS: SVG, PNG, and workspace bundle downloads.')
  await page.getByRole('tab', { name: 'Raw trials' }).click()
  await expect(page.locator('tbody tr')).toHaveCount(120)
  await page.locator('tbody tr').first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('tab', { name: 'Chart', exact: true }).click()
  await page.getByRole('button', { name: 'Model all', exact: true }).click()
  await page.getByRole('menuitemcheckbox').first().click()
  await page.getByRole('heading').first().click()
  await expect(page.locator('.card svg .mark-rect.role-mark path')).toHaveCount(1)
  await page.getByRole('button', { name: 'Clear', exact: true }).click()
  await expect(page.locator('.card svg .mark-rect.role-mark path')).toHaveCount(6)
  console.log('PASS: trial inspection and model filtering.')
  await page.getByRole('tab', { name: 'Presentation', exact: true }).click()
  await page.locator('.vega-embed svg').waitFor()
  assert.equal(await page.getByRole('tab', { name: 'Poster', exact: true }).getAttribute('aria-selected'), 'true')
  assert.equal(await page.getByRole('tab', { name: 'Social images', exact: true }).count(), 0)
  assert.equal(await page.getByRole('tab', { name: 'Motion', exact: true }).count(), 0)
  assert.equal(await page.getByRole('link', { name: 'Static report' }).count(), 0)
  await page.locator('input[type=file]').setInputFiles({ name: 'round-trip.heval-bundle.json', mimeType: 'application/json', buffer: bundle! })
  await expect(page.getByRole('tab', { name: 'Analysis', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.card svg .mark-rect.role-mark path')).toHaveCount(6)
  await page.setViewportSize({ width: 393, height: 851 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false)
  console.log('PASS: presentation, saved bundle reimport, and mobile width.')

  const raw = join(temporary, 'raw harbor job')
  for (const [index, model] of ['model-a', 'model-b'].entries()) {
    const trial = join(raw, `trial-${index}`)
    mkdirSync(trial, { recursive: true })
    writeFileSync(join(trial, 'config.json'), JSON.stringify({ agent: { name: 'codex', model_name: `test/${model}`, env: { OPENAI_API_KEY: 'test-key-not-for-output' } } }))
    writeFileSync(join(trial, 'result.json'), JSON.stringify({ task_name: 'test/task', verifier_result: { reward: index }, agent_info: { version: 'test' }, agent_result: {} }))
  }
  const rawUrl = await launch(cli, [raw], env)
  const result = await (await fetch(new URL('/results/harbor/local.json', rawUrl))).json()
  assert.equal(result.rows.length, 2)
  assert.deepEqual(result.rows.map((row: { costUsd: number | null }) => row.costUsd), [null, null])
  assert.doesNotMatch(JSON.stringify(result), /test-key-not-for-output/)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(rawUrl)
  await expect(page.getByRole('heading', { name: 'raw harbor job', exact: true })).toBeVisible()
  await expect(page.locator('.card svg .mark-rect.role-mark path')).toHaveCount(2)
  const exported = join(temporary, 'raw-export.json')
  writeFileSync(exported, JSON.stringify(result))
  const exportUrl = await launch(cli, [exported], env)
  await page.goto(exportUrl)
  await expect(page.locator('.card svg .mark-rect.role-mark path')).toHaveCount(2)
  console.log('PASS: raw Harbor job and normalized JSON opened from paths outside the repository.')
  assert.deepEqual(errors, [])
  console.log(`${fromRegistry ? 'Published' : 'Packed'} ${name}@${version}: all checks passed on ${process.platform}, Node ${execFileSync(node, ['--version'], { encoding: 'utf8' }).trim()}; no browser runtime errors.`)
} finally {
  await browser?.close()
  for (const child of children.filter(child => child.exitCode === null)) {
    const stopped = new Promise<void>(done => child!.once('exit', () => done()))
    child.kill('SIGTERM')
    await stopped
  }
  rmSync(temporary, { recursive: true, force: true })
}
