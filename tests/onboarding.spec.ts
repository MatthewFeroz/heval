import { expect, test } from '@playwright/test'

const fixture = '/tests/fixtures/onboarding.html'
test('first visit, resume, complete, and reopen without losing the destination', async ({ page }) => {
  await page.goto(fixture + '?report=saved-report#draft')
  await expect(page.getByRole('heading', { name: 'Try the demo' })).toBeFocused()
  await expect(page.getByRole('heading', { name: 'Test workspace' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Check your setup' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Check your setup' })).toBeVisible()
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Try the demo' })).toBeVisible()
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Keep your results' })).toBeVisible()
  await page.getByRole('button', { name: 'Continue to workspace' }).click()
  await expect(page.getByRole('heading', { name: 'Test workspace' })).toBeVisible()
  expect(new URL(page.url()).search).toBe('?report=saved-report')
  expect(new URL(page.url()).hash).toBe('#draft')
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Test workspace' })).toBeVisible()
  await page.goto(fixture + '?guide=cli&report=saved-report#draft')
  await expect(page.getByRole('heading', { name: 'Try the demo' })).toBeVisible()
  await page.getByRole('button', { name: 'Skip for now' }).click()
  await expect(page.getByRole('heading', { name: 'Test workspace' })).toBeVisible()
  expect(new URL(page.url()).search).toBe('?report=saved-report')
  expect(new URL(page.url()).hash).toBe('#draft')
})

test('skip persists for this account while another account gets its own guide', async ({ page }) => {
  await page.goto(fixture)
  await page.getByRole('button', { name: 'Skip for now' }).click()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Test workspace' })).toBeVisible()
  await page.goto(fixture + '?account=bob')
  await expect(page.getByRole('heading', { name: 'Try the demo' })).toBeVisible()
})

test('copy commands, keyboard navigation, and all steps fit the viewport', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text: string) => { sessionStorage.setItem('copied-command', text) } } }))
  await page.goto(fixture)
  await page.getByRole('button', { name: 'Copy Open the example', exact: true }).click()
  expect(await page.evaluate(() => sessionStorage.getItem('copied-command'))).toBe('npx @mattferoz/heval@0.1.0 open')
  await expect(page.getByRole('button', { name: 'Copy Open the example', exact: true })).toHaveText('Copied')
  for (let step = 0; step < 4; step++) {
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    if (step < 3) {
      await page.getByRole('button', { name: 'Next', exact: true }).focus()
      await page.keyboard.press('Enter')
      await expect(page.locator('#cli-guide-title')).toBeFocused()
    }
  }
})

test('storage errors allow retry or continuing without claiming progress was saved', async ({ page }) => {
  await page.goto(fixture + '?loadError=1')
  await expect(page.getByRole('alert')).toContainText('couldn’t load')
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Try the demo' })).toBeVisible()
  await page.goto(fixture + '?saveError=1')
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('couldn’t be saved')
  await expect(page.getByRole('heading', { name: 'Try the demo' })).toBeVisible()
  await page.getByRole('button', { name: 'Continue without saving progress' }).click()
  await expect(page.getByRole('heading', { name: 'Test workspace' })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('test-guide:alice'))).toBeNull()
})
