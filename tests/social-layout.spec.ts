import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { posterDocuments } from '../server/social-posters'
import { SOCIAL_DEFAULTS, SOCIAL_PRESETS, type SocialPreset } from '../src/charts/social-presets'
import { SOCIAL_THEMES, type SocialTheme } from '../src/charts/social-themes'
const input = JSON.parse(readFileSync('results/harbor/terminal-bench-composio-mirror.json', 'utf8'))
for (const theme of Object.keys(SOCIAL_THEMES) as SocialTheme[]) {
  test('all social layouts fit with six models: ' + theme, async ({ page }) => {
    for (const preset of Object.keys(SOCIAL_PRESETS) as SocialPreset[]) {
      for (const html of posterDocuments(input, {
        ...SOCIAL_DEFAULTS,
        theme,
        preset,
        showSubtitle: true,
        showDirection: true,
      }).pages) {
        await page.setContent(html)
        const result = await page.evaluate(() => (window as any).__hevalLayoutReady)
        expect(result.errors, preset).toEqual([])
        expect(
          await page
            .locator('svg')
            .first()
            .evaluate((el) => getComputedStyle(el.querySelector('rect')!).fill),
        ).toBeTruthy()
      }
    }
  })
}
test('long model names fit and impossible numeric labels block export', async ({ page }) => {
  const copy = structuredClone(input)
  copy.rows = copy.rows.map((r: any) => ({
    ...r,
    modelShort: r.modelShort + '-a-very-long-model-release-name',
  }))
  await page.setContent(
    posterDocuments(copy, { ...SOCIAL_DEFAULTS, preset: 'slow-timeouts' }).pages[0],
  )
  const result = await page.evaluate(() => (window as any).__hevalLayoutReady)
  expect(result.errors).toEqual([])
  expect(result.adjustments.length).toBeGreaterThan(0)
  const html = posterDocuments(input, SOCIAL_DEFAULTS).pages[0].replace(
    '>14</text>',
    '>1234567890123456789012345678901234567890</text>',
  )
  await page.setContent(html)
  expect(
    (await page.evaluate(() => (window as any).__hevalLayoutReady)).errors.length,
  ).toBeGreaterThan(0)
})

test('publishing opens with a ready question, optional customization, and saved themes', async ({
  page,
}) => {
  await page.route('**/api/posters/preview', async (route) => {
    const payload = route.request().postDataJSON()
    await route.fulfill({ json: posterDocuments(payload.input, payload.settings) })
  })
  await page.goto('/studio?job=terminal-bench-composio-mirror')
  await expect(page.locator('.card svg')).toBeVisible()
  await page.getByRole('tab', { name: 'Presentation', exact: true }).click()
  await expect(page.getByLabel('Question', { exact: true })).toHaveValue('completed')
  await expect(page.getByLabel('Style', { exact: true })).toHaveValue('merge-dark')
  await expect(page.getByLabel('Source', { exact: true })).not.toBeVisible()
  await expect(page.getByText('Layout checked. Ready to export.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Export image', exact: true })).toBeEnabled()
  await page.getByLabel('Style', { exact: true }).selectOption('merge-light')
  await expect(page.getByText('Layout checked. Ready to export.')).toBeVisible()
  await page.getByText('Customize models, text and thread', { exact: true }).click()
  await expect(page.getByLabel('claude-sonnet-5', { exact: true })).toBeChecked()
  await expect(
    page.locator('.social-customize fieldset').last().getByRole('checkbox', { checked: true }),
  ).toHaveCount(4)
  await page.getByRole('tab', { name: 'Analysis', exact: true }).click()
  await expect(page.locator('.card svg')).toBeVisible()
  await page.getByRole('tab', { name: 'Presentation', exact: true }).click()
  await expect(page.getByLabel('Style', { exact: true })).toHaveValue('merge-light')
  await expect(page.getByLabel('Source', { exact: true })).not.toBeVisible()
})
