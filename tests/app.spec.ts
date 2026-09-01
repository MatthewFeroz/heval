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

test('focuses a runner and stores an early-access signup', async ({ page }) => {
  const lane = page.locator('.runner-lane').filter({ hasText: 'OpenCode' })
  await lane.click()
  await expect(lane).toHaveClass(/focused/)

  await page.getByPlaceholder('you@company.com').fill('dev@example.com')
  await page.getByRole('button', { name: /get early access/i }).last().click()
  await expect(page.getByText('You’re on the list.')).toBeVisible()
  await expect.poll(async () => page.evaluate(() => localStorage.getItem('heval:preferences'))).toContain('dev@example.com')
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
