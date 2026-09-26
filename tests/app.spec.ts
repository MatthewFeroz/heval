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

test('keeps the showcase public while real runs require authentication', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'The open-source evaluation platform for coding agents.', exact: true })).toBeVisible()
  page.once('dialog', async (dialog) => {
    expect(dialog.message()).toContain('WorkOS AuthKit')
    await dialog.dismiss()
  })
  await page.getByRole('button', { name: 'RUN REAL' }).first().click()
})

test('opens evaluations from the landing page', async ({ page }) => {
  await page.getByRole('link', { name: 'Create an evaluation', exact: true }).click()
  await expect(page).toHaveURL(/\/evaluations$/)
  await expect(page.getByRole('heading', { name: /Create an evaluation|Evaluations are coming online/ })).toBeVisible()
})

test('signup failure does not claim the email was saved', async ({ page }) => {
  await page.route('**/api/signups', route => route.fulfill({ status: 503, json: { error: 'Could not save your signup. Please retry.' } }))
  await page.getByPlaceholder('you@company.com').fill('dev@example.com')
  await page.getByLabel('I agree to receive Heval project updates by email.').check()
  await page.getByRole('button', { name: /get early access/i }).last().click()
  await expect(page.getByRole('alert')).toContainText('Could not save')
  await expect(page.getByText('You’re on the list.')).toHaveCount(0)
})
