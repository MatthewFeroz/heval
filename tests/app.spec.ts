import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
})

test('replays the example and reveals its verdict', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'The open-source harness evaluation platform', exact: true })).toBeVisible()
  const timeline = page.getByLabel('Replay timeline')

  await page.getByRole('button', { name: 'Play replay' }).click()
  await expect.poll(async () => Number(await timeline.inputValue())).toBeGreaterThan(0)

  await timeline.fill(await timeline.getAttribute('max') || '0')

  await expect(page.getByText('Example replay complete.')).toBeVisible()
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
  await expect(page.getByRole('heading', { name: 'The open-source harness evaluation platform', exact: true })).toBeVisible()
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

test('shows the product entry point and measured evaluation preview', async ({ page }) => {
  await expect(page.locator('.nav .brand')).toHaveText('heval')
  await expect(page.locator('.hero-harness')).toHaveCount(4)
  const start = page.getByRole('link', { name: 'Get started', exact: true })
  await expect(start).toHaveAttribute('href', /\/studio\?job=terminal-bench-composio-mirror/)
  const github = page.getByRole('link', { name: 'Explore the code on GitHub' })
  await expect(github).toHaveAttribute('href', 'https://github.com/MatthewFeroz/heval')
  const startBox = await start.boundingBox()
  const githubBox = await github.boundingBox()
  expect(githubBox!.y).toBeGreaterThan(startBox!.y + startBox!.height)
  await expect(page.locator('.completion-row')).toHaveCount(6)
  await expect(page.locator('.evaluation-stats')).toContainText('Trials120')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  expect(await page.locator('.hero-harness').first().evaluate((el) => parseFloat(getComputedStyle(el).animationDuration))).toBeLessThan(.001)
  await start.click()
  await expect(page).toHaveURL(/\/studio\?job=terminal-bench-composio-mirror/)
  await expect(page.locator('.card svg').first()).toBeVisible()
})
