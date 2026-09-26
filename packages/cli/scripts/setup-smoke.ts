import { strict as assert } from 'node:assert'
import { spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium, expect } from '@playwright/test'
import { execute } from '../src/setup'

// Exercise the installed tarball, not TypeScript source or a global CLI.
// This test creates its own unpaired worker and never reads real credentials.
const root = resolve(import.meta.dirname, '../../..')
const { name: packageName, version } = JSON.parse(readFileSync(join(root, 'packages/cli/package.json'), 'utf8'))
const temporary = mkdtempSync(join(tmpdir(), 'heval-bootstrap-'))
const worker = `heval-ci-${process.pid}-${Date.now()}`
const volume = `${worker}-data`
const node = realpathSync(Bun.which('node')!)
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
const children: ReturnType<typeof spawn>[] = []
async function launch(cli: string) {
  const child = spawn(node, [cli, 'setup', '--yes', '--no-browser', '--name', worker, '--harnesses', 'pi'], { cwd: temporary, stdio: ['ignore', 'pipe', 'pipe'] })
  children.push(child)
  return new Promise<string>((done, fail) => {
    let output = '', errors = ''
    const timer = setTimeout(() => { child.kill(); fail(new Error('Setup timed out: ' + errors.slice(-3000))) }, 15 * 60_000)
    child.stderr!.on('data', data => { errors = (errors + data).slice(-6000) })
    child.stdout!.on('data', data => {
      output += data
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+\/#token=[a-f0-9]{64}/)
      if (match) { clearTimeout(timer); done(match[0]) }
    })
    child.once('error', error => { clearTimeout(timer); fail(error) })
    child.once('exit', code => { clearTimeout(timer); fail(new Error(`Setup exited ${code}: ${errors}`)) })
  })
}
try {
  writeFileSync(join(temporary, 'package.json'), '{"private":true}')
  const tarball = join(root, '.scratch', `mattferoz-heval-${version}.tgz`)
  await execute('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', temporary, tarball], undefined, false, 60_000)
  const cli = join(temporary, 'node_modules', packageName, 'dist/cli.js')
  const plan = JSON.parse(await execute(node, [cli, 'setup', '--plan', '--json', '--name', worker]))
  assert.equal(plan.needsDocker, false)
  assert.equal(plan.volume, volume)
  assert.equal((await execute('docker', ['ps', '-a', '--filter', `name=^${worker}$`, '--format', '{{.ID}}'])), '')
  const url = await launch(cli)
  const parsed = new URL(url), headers = { Authorization: `Bearer ${parsed.hash.slice(7)}` }
  assert.equal((await fetch(parsed.origin + '/api/status')).status, 403)
  const status = await fetch(parsed.origin + '/api/status', { headers }).then(r => r.json())
  assert.equal(status.worker.ready, true); assert.equal(status.worker.paired, false); assert.equal(status.connected, false)
  assert.equal(await execute('docker', ['exec', worker, 'id', '-u']), '1000')
  const inspect = JSON.parse(await execute('docker', ['inspect', worker]))[0]
  assert.equal(inspect.HostConfig.Privileged, false)
  assert.equal(inspect.HostConfig.RestartPolicy.Name, 'unless-stopped')
  assert.deepEqual(inspect.HostConfig.PortBindings, {})
  // TBLite includes tasks without CPU declarations. Reproduce that shape in
  // this disposable test worker; never rewrite a real benchmark's task files.
  await execute('docker', ['exec', worker, 'python', '-c', 'import pathlib,re,sys; p=pathlib.Path(sys.argv[1]); p.write_text(re.sub(r"(?m)^cpus\\s*=.*\\n", "", p.read_text()))', `/var/lib/docker/volumes/${volume}/_data/runner/tasks/heval-setup/task.toml`])
  const oracle = await execute('docker', ['exec', worker, 'node', '/opt/heval/dist/cli.js', 'runner', 'test', '--profile', 'heval-setup', '--state', `/var/lib/docker/volumes/${volume}/_data/runner`], undefined, false, 6 * 60_000)
  assert.match(oracle, /Grading: 1\/1 passed/)
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  await page.goto(url)
  await expect(page.getByRole('heading', { name: 'Connect your computer', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Connect to Heval', exact: true })).toHaveAttribute('href', /\/machines\?setup=new#worker=/)
  await expect(page.getByLabel('Merge Gateway API key')).not.toBeVisible()
  await expect(page.locator('input[name="harness"][value="pi"]')).toBeChecked()
  await expect(page.locator('input[name="harness"][value="codex"]')).not.toBeChecked()
  await expect(page.locator('input[name="harness"][value="deepseek"]')).toHaveCount(0)
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.screenshot({ path: join(root, '.scratch/setup-mobile.png'), fullPage: true })
  children[0].kill('SIGTERM')
  await execute('docker', ['stop', worker])
  const resumed = new URL(await launch(cli))
  assert.notEqual(resumed.hash, parsed.hash)
  assert.equal(JSON.parse(await execute('docker', ['inspect', worker]))[0].Id, inspect.Id)
  assert.equal((await fetch(resumed.origin + '/api/status', { headers })).status, 403)
  // Refuse artifact drift instead of silently replacing an existing worker.
  writeFileSync(join(temporary, 'node_modules', packageName, 'dist/change.txt'), 'different artifact')
  await assert.rejects(execute(node, [cli, 'setup', '--yes', '--no-browser', '--name', worker]))
  assert.equal(JSON.parse(await execute('docker', ['inspect', worker]))[0].Id, inspect.Id)
  console.log('Installed setup passed: plan, provisioning, private UI, non-root Oracle 1/1, restart/resume, and artifact collision protection. No model calls.')
} finally {
  await browser?.close()
  for (const child of children) child.kill('SIGTERM')
  // Only resources named by this unique test invocation are removed.
  await execute('docker', ['rm', '-f', worker]).catch(() => {})
  await execute('docker', ['volume', 'rm', volume]).catch(() => {})
  rmSync(temporary, { recursive: true, force: true })
}
