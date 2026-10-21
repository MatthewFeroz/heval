import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
})

test('submits an early-access signup', async ({ page }) => {
  await page.route('**/api/signups', async route => {
    expect(route.request().postDataJSON()).toEqual({ email: 'dev@example.com', consent: true })
    await route.fulfill({ status: 201, json: { ok: true } })
  })
  await page.getByLabel('I agree to receive Heval project updates by email.').check()
  await page.getByPlaceholder('you@company.com').fill('dev@example.com')
  await page.getByRole('button', { name: /get early access/i }).last().click()
  await expect(page.getByText('You’re on the list.')).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('heval:preferences'))).toBeNull()
})

test('browses published runs and shares a two-run comparison', async ({ page }) => {
  const runs = page.getByRole('region', { name: 'Every published run. Pick any two.' })
  const comparison = runs.getByRole('complementary', { name: 'Run comparison' })
  await expect(runs.getByRole('button', { name: /selected as run B/ })).toHaveCount(1)
  await expect(comparison).toContainText('Changed')

  await runs.getByRole('tab', { name: /SWE-bench Lite/ }).click()
  await expect(runs.getByRole('table')).toContainText('Pi Agent')
  await expect(comparison).toContainText('Harness')
  await runs.getByRole('button', { name: /^Claude Code on django-11815: passed/ }).click()
  await expect(page).toHaveURL(/study=swe-bench-lite&a=.+&b=django__django-11815__/)
  await expect(comparison).toContainText('Task')

  await page.reload()
  await expect(runs.getByRole('tab', { name: /SWE-bench Lite/ })).toHaveAttribute('aria-selected', 'true')
  await expect(runs.getByRole('button', { name: /^Claude Code on django-11815: .*selected as run B/ })).toBeVisible()
  await expect(comparison).toContainText('gateway usage')
  await expect(comparison).toContainText('820.3K in')
  await expect(comparison).toContainText('Claude Code native turns')
  await expect(comparison).toContainText('100-turn cap')
  await expect(comparison).toContainText('Model requests')

  const sweTab = runs.getByRole('tab', { name: /SWE-bench Lite/ })
  await sweTab.focus()
  await sweTab.press('ArrowLeft')
  await expect(runs.getByRole('tab', { name: /Terminal-Bench/ })).toBeFocused()
  await expect(runs.getByRole('tab', { name: /Terminal-Bench/ })).toHaveAttribute('aria-selected', 'true')
})

test('opens evaluations from the landing page', async ({ page }) => {
  await page.getByRole('link', { name: 'Create an evaluation', exact: true }).click()
  await expect(page).toHaveURL(/\/evaluations$/)
  await expect(page.getByRole('heading', { name: /Create an evaluation|Evaluations are coming online/ })).toBeVisible()
})

test('selects chart runs with mouse and keyboard and keeps the shared comparison', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const chart = page.getByRole('region', { name: 'Cost vs. time chart' })
  const dots = chart.getByRole('button', { name: /^Chart run / })
  await expect(dots).toHaveCount(120)
  await chart.getByRole('button', { name: 'Claude Sonnet 5 20 runs' }).click()
  await expect(dots).toHaveCount(100)
  await chart.getByRole('button', { name: 'Claude Sonnet 5 20 runs' }).click()
  await expect(dots).toHaveCount(120)

  const label = await dots.nth(3).getAttribute('aria-label')
  const point = chart.getByRole('button', { name: label!, exact: false })
  await point.click()
  await expect(point).toHaveAttribute('aria-pressed', 'true')
  const url = page.url()
  await page.reload()
  await expect(chart.getByRole('button', { name: /^Chart run .*selected as [AB]$/ })).toHaveCount(2)
  await expect(page).toHaveURL(url)

  const keyboardPoint = chart.locator('[role="button"][tabindex="0"]')
  await keyboardPoint.focus()
  await keyboardPoint.press('ArrowRight')
  const next = chart.locator('[role="button"]:focus')
  await expect(next).toBeFocused()
  await expect(chart.locator('.runs-scatter-detail')).not.toContainText('Point to a run')
  await next.press('Enter')
  await expect(next).toHaveAttribute('aria-pressed', 'true')

  await page.setViewportSize({ width: 390, height: 844 })
  await chart.getByRole('button', { name: 'Linear', exact: true }).click()
  await expect(chart).toContainText('starting at zero')
  await page.getByRole('tab', { name: /SWE-bench Lite/ }).click()
  await expect(dots).toHaveCount(140)
  await expect(chart).toContainText('Harnesses')
  await chart.locator('svg').scrollIntoViewIfNeeded()
  await chart.getByRole('button', { name: /^Chart run DeepSeek Harness on sympy-11400:/ }).click()
  await expect(page).toHaveURL(/study=swe-bench-lite/)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('signup failure does not claim the email was saved', async ({ page }) => {
  await page.route('**/api/signups', route => route.fulfill({ status: 503, json: { error: 'Could not save your signup. Please retry.' } }))
  await page.getByPlaceholder('you@company.com').fill('dev@example.com')
  await page.getByLabel('I agree to receive Heval project updates by email.').check()
  await page.getByRole('button', { name: /get early access/i }).last().click()
  await expect(page.getByRole('alert')).toContainText('Could not save')
  await expect(page.getByText('You’re on the list.')).toHaveCount(0)
})
