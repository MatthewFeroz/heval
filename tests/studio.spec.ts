import { expect, test } from '@playwright/test'

const JOB = 'terminal-bench-glm53-smoke'
test.beforeEach(async ({ page }) => {
  await page.goto(`/studio?job=${JOB}&recipe=bar&x=agent&color=modelShort&measure=passed`)
  await expect(page.getByRole('heading', { name: JOB })).toBeVisible()
})

test('renders the job the URL names and reports its limits', async ({ page }) => {
  await expect(page.locator('.card svg')).toBeVisible()
  await expect(page.getByText('Only 1 trial in the smallest group')).toBeVisible()
  // Four stacks, one bar each.
  await expect(page.locator('.card svg .mark-rect.role-mark path')).toHaveCount(4)
})

test('a control change re-renders the chart and travels in the URL', async ({ page }) => {
  await page.locator('#f-recipe').selectOption('scatter')
  await expect(page).toHaveURL(/recipe=scatter/)
  // Three of the four stacks, because the gateway reported no cost for one.
  await expect(page.locator('.card svg .mark-symbol.role-mark path')).toHaveCount(3)
  await expect(page.getByText('1 trial excluded from Cost (USD)')).toBeVisible()

  await page.locator('#f-xMeasure').selectOption('agentSeconds')
  await expect(page).toHaveURL(/xMeasure=agentSeconds/)
  await expect(page.locator('.card svg')).toContainText('Agent time (s) per trial (mean)')
})

test('collapses color when it would just repeat the grouping', async ({ page }) => {
  // Coloring by the same field the bars are already grouped by encodes nothing.
  await page.locator('#f-color').selectOption('agent')
  await expect(page.locator('.card svg')).toBeVisible()
  await expect(page.locator('.card svg .mark-rect.role-mark path')).toHaveCount(2)
  await expect(page.locator('.card svg')).not.toContainText('Model (short)')
})

test('the table and spec tabs expose the plotted numbers', async ({ page }) => {
  await page.getByRole('tab', { name: 'Table view' }).click()
  await expect(page.getByRole('columnheader', { name: 'Trials' })).toBeVisible()
  await expect(page.getByRole('cell', { name: '100%', exact: true }).first()).toBeVisible()

  await page.getByRole('tab', { name: 'Vega-Lite spec' }).click()
  await expect(page.locator('textarea.spec')).toContainText('vega-lite/v6.json')

  await page.getByRole('tab', { name: 'Raw trials' }).click()
  await expect(page.getByRole('cell', { name: 'fix-git' }).first()).toBeVisible()
})

test('exports the chart as SVG', async ({ page }) => {
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'SVG', exact: true }).click()
  expect((await download).suggestedFilename()).toBe(`${JOB}-bar.svg`)
})

test('dark mode is a selected theme, not an inverted one', async ({ page }) => {
  // The theme radios are `sr-only`, so the icon inside the pill owns the hit
  // point and `.check()` cannot reach the input. Click the pill, like a person.
  await page.locator('.canvas-btn', { hasText: 'Dark mode' }).click()
  await expect(page.getByLabel('Dark mode')).toBeChecked()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  // The dark categorical slot 1 uses Merge Robin, not the light palette step.
  await expect(page.locator('.card svg .mark-rect.role-mark path').first()).toHaveAttribute('fill', '#96BDCE')
})

test('separates saved analysis from pinned presentation configuration', async ({ page }) => {
  await expect(page.getByRole('tab', { name: 'Analysis', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByLabel('Project sources')).toContainText(JOB)
  await page.getByRole('button', { name: 'Save view' }).click()

  await page.getByRole('tab', { name: 'Presentation', exact: true }).click()
  await expect(page).toHaveURL(/mode=presentation/)
  await expect(page.getByRole('tab', { name: 'Poster', exact: true })).toBeVisible()
  await expect(page.getByText('1 immutable source snapshot pinned')).toBeVisible()

  await page.locator('#f-presentation-theme').selectOption('plain-light')
  await expect(page.getByLabel('Light mode')).toBeChecked()
  // A theme applies a recommendation, but the graph setting remains editable.
  await page.locator('.canvas-btn', { hasText: 'Dark mode' }).click()
  await expect(page.getByLabel('Dark mode')).toBeChecked()
})

test('downloads referenced project and self-contained bundle files', async ({ page }) => {
  const projectDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Project', exact: true }).click()
  expect((await projectDownload).suggestedFilename()).toMatch(/\.heval-project\.json$/)

  const bundleDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Bundle', exact: true }).click()
  expect((await bundleDownload).suggestedFilename()).toMatch(/\.heval-bundle\.json$/)
})
