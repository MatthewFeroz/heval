/** Real task viewer, synthetic evidence, no backend or model calls. */
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { createServer } from 'vite'
import { chromium, expect } from '@playwright/test'
import fixture from '../results/harbor/demo-evaluation.json'
const capture = process.argv.includes('--capture') ? process.argv[process.argv.indexOf('--capture') + 1] : ''
if (capture) await mkdir(capture, { recursive: true })
const rows = [
  { ...fixture.rows[0], trial: 'attempt-a', passed: 1, error: null },
  { ...fixture.rows[1], trial: 'attempt-b', passed: 0, error: null },
  { ...fixture.rows[0], trial: 'repeat-a', passed: 1, error: null },
  { ...fixture.rows[0], trial: 'other-task', task: 'another-task', taskFull: 'demo/another-task', taskChecksum: null, passed: 0, timedOut: 1, error: null },
]
const artifact = (id: string, trial: string, kind: string, text: string) => ({ id, trial, kind, text, title: `Demonstration ${kind}`, hash: 'synthetic', published: false })
const evidence = [
  artifact('tests-a', 'attempt-a', 'verifier', 'All demonstration tests passed.'),
  artifact('tests-b', 'attempt-b', 'verifier', 'Demonstration test failed: expected 3, received 2.'),
  artifact('patch-a', 'attempt-a', 'patch', '--- a/example.ts\n+++ b/example.ts\n- return 2\n+ return 3'),
  artifact('timeline-a', 'attempt-a', 'timeline', JSON.stringify({ schemaVersion: 1, events: [{ at: 1000, kind: 'command', title: 'Run demonstration tests', text: 'bun test example.test.ts' }, { at: 2000, kind: 'edit', title: 'Update the demonstration calculation', text: 'Changed the return value.' }, { at: 3000, kind: 'passed', title: 'Demonstration verification passed' }] })),
  artifact('html-a', 'attempt-a', 'html', '<!doctype html><html><head><meta http-equiv="refresh" content="0;url=https://evidence.invalid/refresh"><style>body{font-family:system-ui;padding:20px;background:#f4f4f4;color:#151515}article{padding:24px;background:white;border-radius:12px}</style><script>parent.document.body.dataset.evidenceEscaped="yes";fetch("https://evidence.invalid/script")</script></head><body><article><h1>Synthetic output preview</h1><p>This is a demonstration, not an actual model result.</p><a href="https://evidence.invalid/link">External navigation</a><img src="https://evidence.invalid/pixel"><form action="https://evidence.invalid/form"><button>Submit</button></form><iframe src="https://evidence.invalid/embed"></iframe></article></body></html>'),
  artifact('image-a', 'attempt-a', 'image', 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDVkAAAAASUVORK5CYII='),
]
const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/__run-viewer.tsx"></script></body></html>'
const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'run-viewer-demonstration',
  configureServer(server) { server.middlewares.use(async (request, response, next) => { if (request.url?.split('?')[0] !== '/__run-viewer') return next(); response.setHeader('Content-Type', 'text/html'); response.end(await server.transformIndexHtml('/__run-viewer', html)) }) },
  resolveId(id) { if (id === '/__run-viewer.tsx') return id },
  load(id) { if (id === '/__run-viewer.tsx') return `import React from 'react';import{createRoot}from'react-dom/client';import{TaskBrowser}from'/src/reports/TaskBrowser.tsx';import{Brand}from'/src/components/SiteHeader.tsx';import'/src/reports/reports.css';createRoot(document.getElementById('root')).render(<main className="report-shell"><Brand/><h1>Synthetic run comparison demonstration</h1><TaskBrowser rows={${JSON.stringify(rows)}} evidence={${JSON.stringify(evidence)}}/></main>)` },
}] })
await server.listen()
const browser = await chromium.launch(), origin = server.resolvedUrls!.local[0]
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] })
const page = await context.newPage(), errors: string[] = [], requests: string[] = []
page.on('pageerror', error => errors.push(error.message))
page.on('request', request => requests.push(request.url()))
const left = page.getByRole('region', { name: 'Left attempt' }), right = page.getByRole('region', { name: 'Right attempt' })
try {
  await page.goto(origin + '__run-viewer')
  await expect(left).toContainText('All demonstration tests passed.')
  await expect(right).toContainText('expected 3, received 2')
  await page.getByLabel('Show tasks', { exact: true }).selectOption('differences')
  await expect(page.getByRole('navigation', { name: 'Tasks' }).getByRole('button')).toHaveCount(1)
  await page.getByRole('button', { name: 'Timeline', exact: true }).click()
  await expect(left).toContainText('Run demonstration tests')
  await left.getByRole('button', { name: 'Next recorded event' }).click()
  await expect(left.getByRole('heading', { name: 'Update the demonstration calculation' })).toBeVisible()
  await left.getByLabel('Recorded event', { exact: true }).fill('2')
  await expect(left.getByRole('heading', { name: 'Demonstration verification passed' })).toBeVisible()
  await page.getByRole('button', { name: 'Patch', exact: true }).click()
  await expect(left).toContainText('+ return 3')
  await expect(right).toContainText('No patch was recorded')
  await page.getByRole('combobox', { name: 'Right attempt', exact: true }).selectOption('repeat-a')
  await page.getByRole('button', { name: 'Copy comparison link' }).click()
  const link = await page.evaluate(() => navigator.clipboard.readText())
  assert.equal(new URL(link).searchParams.get('right'), 'repeat-a')
  await page.goto(link)
  await expect(page.getByRole('combobox', { name: 'Right attempt', exact: true })).toHaveValue('repeat-a')
  await expect(page.getByRole('button', { name: 'Patch', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('combobox', { name: 'Right attempt', exact: true }).selectOption('attempt-b')
  await page.goBack()
  await expect(page.getByRole('combobox', { name: 'Right attempt', exact: true })).toHaveValue('repeat-a')
  await page.getByRole('button', { name: 'Output', exact: true }).click()
  await left.getByRole('button', { name: 'Load output preview' }).click()
  const frame = page.frameLocator('iframe[title="Recorded HTML output"]')
  await expect(frame.getByRole('heading', { name: 'Synthetic output preview' })).toBeVisible()
  await expect(frame.locator('script,iframe,form,base,meta[http-equiv=refresh]')).toHaveCount(0)
  await expect(frame.getByText('External navigation')).not.toHaveAttribute('href')
  assert.equal(await page.getAttribute('body', 'data-evidence-escaped'), null)
  assert(!requests.some(url => url.includes('evidence.invalid')), 'Output preview must not make outbound requests')
  await left.getByRole('combobox', { name: 'Left artifact' }).selectOption('image-a')
  await left.getByRole('button', { name: 'Expand screenshot' }).click()
  await expect(left.getByRole('button', { name: 'Fit screenshot' })).toHaveAttribute('aria-expanded', 'true')
  await left.getByRole('button', { name: 'Fit screenshot' }).click()
  await left.getByRole('combobox', { name: 'Left artifact' }).selectOption('html-a')
  await left.getByRole('button', { name: 'Load output preview' }).click()
  if (capture) {
    for (const [name, width, height] of [['desktop', 1440, 1000], ['tablet', 900, 1000], ['mobile', 390, 844]] as const) {
      await page.setViewportSize({ width, height })
      await expect(page.frameLocator('iframe[title="Recorded HTML output"]').getByRole('heading', { name: 'Synthetic output preview' })).toBeVisible()
      await page.evaluate(async () => { await document.fonts.ready; await new Promise(requestAnimationFrame) })
      await page.screenshot({ path: `${capture}/run-output-${name}.png`, fullPage: true })
      await page.locator('iframe[title="Recorded HTML output"]').scrollIntoViewIfNeeded()
      await page.evaluate(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame) })
      await page.screenshot({ path: `${capture}/preview-viewport-${name}.png` })
    }
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByLabel('Show tasks', { exact: true }).selectOption('timeouts')
  await expect(page.getByText('Only one attempt was recorded', { exact: false })).toBeVisible()
  await page.getByLabel('Find a task', { exact: true }).fill('missing-task')
  await expect(page.getByText('No tasks match these filters.', { exact: true })).toBeVisible()
  assert.deepEqual(errors, [])
  console.log('PASS: task filters, repeated attempts, evidence comparison, timeline controls, deep links and browser back, private labels, isolated output previews, screenshot controls, and narrow layouts. Synthetic fixtures only.')
} catch (error) { console.error({ errors, body: (await page.locator('body').innerText()).slice(0, 2000) }); throw error } finally { await browser.close(); await server.close() }
