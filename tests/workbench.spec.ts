import { test, expect } from '@playwright/test'
import { exportRuns } from '../server/run-export'
import type { Run } from '../server/types'

test('configure, launch, inspect measured results, reload history and open Studio', async ({ page }) => {
  const runs: Run[] = []
  await page.route('**/api/config', route => route.fulfill({ json: { models: ['nvidia/lightning', 'nvidia/super'], harnesses: ['pi-agent'], tasks: [{ id: 'concurrent-cache-v1', label: 'Async cache race condition' }], maxTimeoutMs: 300000, maxDailyPerUser: 6, runnerEnabled: true, canRun: true } }))
  await page.route('**/api/runs', async route => {
    expect(route.request().headers().authorization).toBe('Bearer browser-test-token')
    if (route.request().method() === 'POST') {
      const config = route.request().postDataJSON()
      expect(config.model).toBe('nvidia/super'); expect(config.harness).toBe('pi-agent'); expect(config.timeoutMs).toBe(120000)
      runs.push({ ...config, id: 'browser-attempt', ownerId: 'alice', gateway: 'merge-gateway', status: 'complete', startedAt: '2026-09-10T12:00:00Z', finishedAt: '2026-09-10T12:00:42Z', agentFinishedAt: '2026-09-10T12:00:40Z',
        grade: { passed: true, exitCode: 0, output: '2 pass, 0 fail' }, costUsd: null, totalTokens: null, chunks: [{ at: 1, data: 'Ran the real fixture tests\r\n' }] })
      await route.fulfill({ status: 202, json: { id: runs[0].id } })
    } else await route.fulfill({ json: runs.map(run => ({ ...run, chunks: [] })) })
  })
  await page.route('**/api/runs/browser-attempt?after=*', route => route.fulfill({ json: { ...runs[0], chunks: runs[0].chunks.slice(Number(new URL(route.request().url()).searchParams.get('after'))) } }))
  await page.route('**/api/runs/export?ids=*', route => route.fulfill({ json: exportRuns(runs) }))
  await page.route('**/studio?runs=*', async route => {
    const response = await route.fetch({ url: new URL('/tests/fixtures/workbench.html', route.request().url()).href })
    await route.fulfill({ response })
  })
  await page.goto('/tests/fixtures/workbench.html')
  await page.getByRole('combobox', { name: 'Model', exact: true }).selectOption('nvidia/super')
  await page.getByLabel('Time limit, seconds').fill('120')
  await page.getByRole('button', { name: 'Launch evaluation' }).click()
  await expect(page.locator('.run-metrics')).toContainText('42s')
  await expect(page.locator('.run-metrics')).toContainText('Passed')
  await expect(page.locator('.run-metrics').getByText('Unavailable')).toHaveCount(2)
  await page.reload()
  await expect(page.locator('.run-history')).toContainText('nvidia/super')
  await page.getByRole('button', { name: /nvidia\/super/ }).click()
  await page.getByRole('link', { name: 'Review in Studio' }).click()
  await expect(page.locator('.card svg')).toBeVisible()
  await page.getByRole('tab', { name: /Raw trials/ }).click()
  await expect(page.locator('table.runs tbody')).toContainText('super')
  await expect(page.getByRole('button', { name: 'Bundle', exact: true })).toBeEnabled()
})

test('failed launch keeps the configuration and reports capacity', async ({ page }) => {
  await page.route('**/api/config', route => route.fulfill({ json: { models: ['nvidia/lightning'], harnesses: ['pi-agent'], tasks: [{ id: 'concurrent-cache-v1', label: 'Async cache' }], maxTimeoutMs: 300000, maxDailyPerUser: 6, runnerEnabled: true, canRun: true } }))
  await page.route('**/api/runs', route => route.fulfill(route.request().method() === 'POST' ? { status: 429, json: { error: 'Evaluation capacity reached' } } : { json: [] }))
  await page.goto('/tests/fixtures/workbench.html')
  await page.getByRole('button', { name: 'Launch evaluation' }).click()
  await expect(page.getByRole('alert')).toHaveText('Evaluation capacity reached')
  await expect(page.getByRole('combobox', { name: 'Model', exact: true })).toHaveValue('nvidia/lightning')
  await expect(page.getByRole('button', { name: 'Launch evaluation' })).toBeEnabled()
})

test('connect, validate, configure, replace and delete a provider without browser credential storage', async ({ page }) => {
  let connected = false
  let replacement = false
  const status = () => ({ connected, provider: 'merge-gateway', models: connected ? ['nvidia/lightning', 'nvidia/super'] : [], validatedAt: '2026-09-10T12:00:00Z' })
  await page.route('**/api/config', route => route.fulfill({ json: { ...status(), harnesses: ['pi-agent'], tasks: [{ id: 'concurrent-cache-v1', label: 'Async cache' }], maxTimeoutMs: 300000, maxDailyPerUser: 6, runnerEnabled: true, canRun: connected, providerSettings: true, connectionRequired: !connected } }))
  await page.route('**/api/runs', route => route.fulfill({ json: [] }))
  await page.route('**/api/connections/merge-gateway', async route => {
    expect(route.request().headers().authorization).toBe('Bearer browser-test-token')
    const method = route.request().method()
    if (method === 'DELETE') connected = false
    if (method === 'POST') {
      const body = route.request().postDataJSON()
      if (body.action === 'connect') {
        if (body.apiKey === 'invalid-test-key') return route.fulfill({ status: 401, json: { error: 'Merge Gateway rejected this key. Check that it is an active Gateway key.' } })
        replacement = connected
        connected = true
      } else expect(body).toEqual({ action: 'validate' })
    }
    await route.fulfill({ json: status() })
  })
  await page.goto('/tests/fixtures/workbench.html')
  await expect(page.getByRole('button', { name: 'Launch evaluation' })).toBeDisabled()
  await page.getByRole('button', { name: 'Provider settings', exact: true }).click()
  const key = page.getByLabel('Gateway API key', { exact: true })
  await expect(key).toHaveAttribute('type', 'password')
  await key.fill('invalid-test-key')
  await page.getByRole('button', { name: 'Validate and connect' }).click()
  await expect(page.getByRole('alert')).toContainText('rejected this key')
  await expect(key).toHaveValue('')
  await key.fill('valid-test-key')
  await page.getByRole('button', { name: 'Validate and connect' }).click()
  await expect(page.getByRole('status')).toContainText('Connection saved')
  await expect(page.getByRole('button', { name: 'Launch evaluation' })).toBeEnabled()
  await page.getByText('2 available models with tool calling').click()
  await expect(page.locator('.provider-models')).toContainText('nvidia/super')
  await page.getByRole('combobox', { name: 'Model', exact: true }).selectOption('nvidia/super')
  await page.getByLabel('Time limit, seconds').fill('120')
  await page.getByRole('button', { name: 'Validate connection', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('model list is up to date')
  await page.getByRole('button', { name: 'Replace key', exact: true }).click()
  await key.fill('replacement-test-key')
  await page.getByRole('button', { name: 'Validate and replace key' }).click()
  await expect(page.getByRole('status')).toContainText('Connection saved')
  expect(replacement).toBe(true)
  const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))
  expect(storage).not.toContain('test-key')
  await page.screenshot({ path: `/tmp/heval-provider-settings-${test.info().project.name}.png`, fullPage: true })
  await page.reload()
  await page.getByRole('button', { name: 'Provider settings', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Replace key', exact: true })).toBeVisible()
  await expect(key).toHaveCount(0)
  await page.getByRole('button', { name: 'Delete connection', exact: true }).click()
  await page.getByRole('button', { name: 'Delete and stop runs' }).click()
  await expect(page.getByRole('status')).toContainText('Connection deleted')
  await expect(page.getByRole('button', { name: 'Launch evaluation' })).toBeDisabled()
  await expect(key).toHaveValue('')
})
