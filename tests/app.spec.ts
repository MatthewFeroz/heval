import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
})

test('replays a benchmark and reveals its verdict', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Heval.' })).toBeVisible()
  const timeline = page.getByLabel('Replay timeline')

  await page.getByRole('button', { name: 'Play replay' }).click()
  await expect.poll(async () => Number(await timeline.inputValue())).toBeGreaterThan(0)

  await timeline.fill(await timeline.getAttribute('max') || '0')

  await expect(page.getByText('All four harnesses passed.')).toBeVisible()
})

test('focuses a runner and submits an early-access signup', async ({ page }) => {
  const lane = page.locator('.runner-lane').filter({ hasText: 'OpenCode' })
  await lane.click()
  await expect(lane).toHaveClass(/focused/)

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

test('keeps the showcase public while real runs require authentication', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Heval.' })).toBeVisible()
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('WorkOS AuthKit')
    await dialog.dismiss()
  })
  await page.getByRole('button', { name: 'RUN REAL' }).first().click()
})

test('opens the responsive navigation', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('mobile'), 'Mobile-only behavior')
  await page.getByRole('button', { name: 'Toggle navigation' }).click()
  await expect(page.getByRole('link', { name: 'Reports', exact: true })).toBeVisible()
})

test('signup failure does not claim the email was saved', async ({ page }) => {
  await page.route('**/api/signups', route => route.fulfill({ status: 503, json: { error: 'Could not save your signup. Please retry.' } }))
  await page.getByPlaceholder('you@company.com').fill('dev@example.com')
  await page.getByLabel('I agree to receive Heval project updates by email.').check()
  await page.getByRole('button', { name: /get early access/i }).last().click()
  await expect(page.getByRole('alert')).toContainText('Could not save')
  await expect(page.getByText('You’re on the list.')).toHaveCount(0)
})
