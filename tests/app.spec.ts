import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
})

test('replays the example and reveals its verdict', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'The open-source evaluation platform for coding agents.', exact: true })).toBeVisible()
  const timeline = page.getByLabel('Replay timeline')

  await page.getByRole('button', { name: 'Play replay' }).click()
  await expect.poll(async () => Number(await timeline.inputValue())).toBeGreaterThan(0)

  await timeline.fill(await timeline.getAttribute('max') || '0')

  await expect(page.getByText('Example replay complete.')).toBeVisible()
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
  await expect(page.getByRole('heading', { name: 'The open-source evaluation platform for coding agents.', exact: true })).toBeVisible()
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('WorkOS AuthKit')
    await dialog.dismiss()
  })
  await page.getByRole('button', { name: 'RUN REAL' }).first().click()
})

test('shows the GitHub link in the simplified navigation', async ({ page }) => {
  const nav = page.getByRole('navigation')
  const github = nav.getByRole('link', { name: 'GitHub', exact: true })
  await expect(github).toBeVisible()
  await expect(github).toHaveAttribute('href', 'https://github.com/MatthewFeroz/heval')
  await expect(github).toHaveAttribute('target', '_blank')
  await expect(nav.getByRole('link', { name: /^(Replay|Reports|Methodology|Studio|Your reports|Machines & runs)$/ })).toHaveCount(0)
})

test('shows the product entry point and measured evaluation preview', async ({ page }) => {
  await expect(page.locator('.nav .brand')).toHaveText('heval')
  await expect(page.locator('.hero-harness')).toHaveCount(7)
  await expect(page.locator('.hero-harnesses').getByRole('link')).toHaveCount(0)
  await expect(page.locator('.hero-harnesses').getByRole('img', { name: 'Deep Agents' })).toBeVisible()
  await expect(page.locator('.hero-harnesses').getByRole('img', { name: 'Antigravity' })).toBeVisible()
  await expect(page.locator('.hero-harnesses').getByRole('img', { name: 'Grok' })).toBeVisible()
  await expect(page.locator('.hero-copy')).toContainText('Compare Claude Code')
  await expect(page.locator('.hero-copy')).toContainText('Run evaluations locally with Harbor')
  await expect(page.locator('.hero-harnesses')).toHaveText('')
  await expect(page.locator('.hero-harnesses').getByRole('img', { name: /Hermes|Goose|OpenHands|Gemini CLI/ })).toHaveCount(0)
  await expect(page.locator('main > section').nth(1)).toHaveAttribute('id', 'compare')
  await expect(page.locator('main > section').nth(2)).toHaveClass(/studio-showcase/)
  const start = page.getByRole('link', { name: 'Import your results', exact: true })
  await expect(start).toHaveAttribute('href', '/reports')
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
  await expect(page).toHaveURL(/\/reports$/)
  await expect(page.getByRole('heading', { name: /Your evaluations, ready to share|Saved reports are coming online/ })).toBeVisible()
})

test('signup failure does not claim the email was saved', async ({ page }) => {
  await page.route('**/api/signups', route => route.fulfill({ status: 503, json: { error: 'Could not save your signup. Please retry.' } }))
  await page.getByPlaceholder('you@company.com').fill('dev@example.com')
  await page.getByLabel('I agree to receive Heval project updates by email.').check()
  await page.getByRole('button', { name: /get early access/i }).last().click()
  await expect(page.getByRole('alert')).toContainText('Could not save')
  await expect(page.getByText('You’re on the list.')).toHaveCount(0)
})
