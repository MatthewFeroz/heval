import { adaptJobExportV1, contentHash } from '../src/project/schema'
import { expect, test } from '@playwright/test'

const JOB = 'terminal-bench-glm53-smoke'
test.beforeEach(async ({ page }) => {
  // Exercise the real gated route with a signed-in, test-only provider.
  await page.route('**/studio?*', async route => {
    const response = await route.fetch({ url: new URL('/tests/fixtures/workbench.html', route.request().url()).href })
    await route.fulfill({ response })
  })
  await page.goto(`/studio?job=${JOB}&recipe=bar&x=agent&color=modelShort&measure=passed`)
  await expect(page.getByRole('heading', { name: JOB })).toBeVisible()
  await expect(page.locator('.card svg')).toBeVisible()
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
  await expect(page.locator('#f-color option[value=agent]')).toBeDisabled()
  await page.locator('#f-color').selectOption('none')
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
  await page.getByRole('tab', { name: 'Poster', exact: true }).click()
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

test('changing recipes preserves chosen fields', async ({ page }) => {
  await page.locator('#f-measure').selectOption('agentSeconds')
  await page.locator('#f-x').selectOption('modelShort')
  await page.locator('#f-recipe').selectOption('strip')
  await expect(page.locator('#f-measure')).toHaveValue('agentSeconds')
  await expect(page.locator('#f-x')).toHaveValue('modelShort')
  await page.locator('#f-recipe').selectOption('bar')
  await expect(page.locator('#f-measure')).toHaveValue('agentSeconds')
})

test('project downloads include the current chart draft', async ({ page }) => {
  await page.locator('#f-measure').selectOption('agentSeconds')
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Project', exact: true }).click()
  const download = await pending
  const stream = await download.createReadStream()
  const chunks = []
  for await (const chunk of stream!) chunks.push(chunk)
  const project = JSON.parse(Buffer.concat(chunks).toString())
  expect(project.analysisViews[0].chart.measure).toBe('agentSeconds')
})

test('spec drafts do not replace the preview until applied', async ({ page }) => {
  await page.getByRole('tab', { name: 'Vega-Lite spec' }).click()
  const original = await page.locator('textarea.spec').inputValue()
  await page.locator('textarea.spec').fill('{')
  await page.getByRole('tab', { name: 'Chart', exact: true }).click()
  await expect(page.locator('.card svg')).toBeVisible()
  await page.getByRole('tab', { name: 'Vega-Lite spec' }).click()
  const spec = JSON.parse(original)
  spec.title = 'Custom preview'
  await page.locator('textarea.spec').fill(JSON.stringify(spec))
  await page.getByRole('button', { name: 'Apply spec', exact: true }).click()
  await page.getByRole('tab', { name: 'Chart', exact: true }).click()
  await expect(page.locator('.card svg')).toContainText('Custom preview')
  await page.getByRole('button', { name: 'Return to controls' }).click()
  await expect(page.locator('.card svg')).not.toContainText('Custom preview')
})

test('presentation retains its saved filters when analysis filters change', async ({ page }) => {
  await page.getByRole('button', { name: 'Harness all' }).click()
  await page.getByRole('menuitemcheckbox').first().click()
  await page.getByRole('heading', { name: JOB }).click()
  await page.getByRole('tab', { name: 'Presentation', exact: true }).click()
  await page.getByRole('tab', { name: 'Poster', exact: true }).click()
  await expect(page.locator('.card svg .mark-rect.role-mark path')).toHaveCount(2)
  await page.getByRole('tab', { name: 'Analysis', exact: true }).click()
  await page.getByRole('button', { name: 'Clear', exact: true }).click()
  await expect(page.locator('.card svg .mark-rect.role-mark path')).toHaveCount(4)
  await page.getByRole('tab', { name: 'Presentation', exact: true }).click()
  await page.getByRole('tab', { name: 'Poster', exact: true }).click()
  await expect(page.locator('.card svg .mark-rect.role-mark path')).toHaveCount(2)
})

test('analysis edits support undo and redo', async ({ page }) => {
  await page.locator('#f-measure').selectOption('costUsd')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(page.locator('#f-measure')).toHaveValue('passed')
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect(page.locator('#f-measure')).toHaveValue('costUsd')
})

test('custom specs reopen from bundles and stay attached to their saved view', async ({ page }) => {
  await page.getByRole('tab', { name: 'Vega-Lite spec' }).click()
  const spec = JSON.parse(await page.locator('textarea.spec').inputValue())
  spec.title = 'Saved custom chart'
  await page.locator('textarea.spec').fill(JSON.stringify(spec))
  await page.getByRole('button', { name: 'Apply spec', exact: true }).click()
  await expect(page.locator('#f-recipe')).toBeDisabled()
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Bundle', exact: true }).click()
  const download = await pending
  const stream = await download.createReadStream()
  const chunks = []
  for await (const chunk of stream!) chunks.push(chunk)
  const buffer = Buffer.concat(chunks)
  expect(JSON.parse(buffer.toString()).project.analysisViews[0].customSpec).toContain('Saved custom chart')
  await page.locator('input[type=file]').setInputFiles({ name: 'saved.heval-bundle.json', mimeType: 'application/json', buffer })
  await page.getByRole('tab', { name: 'Chart', exact: true }).click()
  await expect(page.locator('.card svg')).toContainText('Saved custom chart')
  await page.getByRole('button', { name: 'Return to controls' }).click()
  await expect(page.locator('#f-recipe')).toBeEnabled()
})

test('saving analysis does not change a presentation and revisions remain selectable', async ({ page }) => {
  await page.getByRole('tab', { name: 'Presentation', exact: true }).click()
  await page.getByRole('tab', { name: 'Poster', exact: true }).click()
  await page.locator('#f-narrative-title').fill('First revision')
  await page.getByRole('button', { name: 'New editorial revision' }).click()
  await page.locator('#f-narrative-title').fill('Second revision')
  await page.locator('#f-revision').selectOption({ index: 0 })
  await expect(page.locator('#f-narrative-title')).toHaveValue('First revision')
  await page.getByRole('tab', { name: 'Analysis', exact: true }).click()
  await page.locator('#f-measure').selectOption('costUsd')
  await page.getByRole('button', { name: 'Save view', exact: true }).click()
  await page.getByRole('tab', { name: 'Presentation', exact: true }).click()
  await page.getByRole('tab', { name: 'Poster', exact: true }).click()
  await expect(page.locator('#f-measure')).toHaveValue('passed')
  await expect(page.locator('.card svg')).toContainText('First revision')
})

test('motion preview receives the filtered presentation data', async ({ page }) => {
  await page.route('**/api/health', (route) => route.fulfill({ json: { exportsEnabled: true } }))
  await page.route('**/api/social/preview', (route) => route.fulfill({ contentType: 'text/html', body: '<html><body>Preview</body></html>' }))
  await page.getByRole('button', { name: 'Harness all' }).click()
  await page.getByRole('menuitemcheckbox').first().click()
  await page.getByRole('heading', { name: JOB }).click()
  await page.getByRole('tab', { name: 'Presentation', exact: true }).click()
  await page.getByRole('tab', { name: 'Poster', exact: true }).click()
  const request = page.waitForRequest('**/api/social/preview')
  await page.getByRole('tab', { name: 'Motion', exact: true }).click()
  const input = (await request).postDataJSON().input
  expect(input.rows).toHaveLength(2)
  expect(new Set(input.rows.map((row: { agent: string }) => row.agent)).size).toBe(1)
  await expect(page.locator('hyperframes-player')).toHaveAttribute('src', /^blob:/)
  await page.route('**/api/social/export', async (route) => {
    expect(route.request().postDataJSON().input).toEqual(input)
    await route.fulfill({ contentType: 'image/png', body: 'test-image' })
  })
  const exported = page.waitForRequest('**/api/social/export')
  await page.getByRole('button', { name: 'PNG', exact: true }).click()
  await exported
})


test('imported custom fields can be charted and filtered', async ({ page }) => {
  const legacy = await (await page.request.get(`/results/harbor/${JOB}.json`)).json()
  const artifact = await adaptJobExportV1(legacy)
  artifact.id = 'custom-fields'
  artifact.fields.push(
    { id: 'quality.score', label: 'Quality score', kind: 'metric', valueType: 'number', unit: 'ratio', direction: 'higher' },
    { id: 'region', label: 'Region', kind: 'dimension', valueType: 'string' },
  )
  artifact.records.forEach((record, index) => { record.values['quality.score'] = index < 2 ? 0.5 : 0.9; record.values.region = index < 2 ? 'West' : 'East' })
  artifact.contentHash = await contentHash(artifact)
  await page.locator('input[type=file]').setInputFiles({ name: 'custom.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(artifact)) })
  await page.locator('#f-measure').selectOption('custom:quality%2Escore')
  await page.locator('#f-x').selectOption('custom:region')
  await page.locator('#f-color').selectOption('none')
  await expect(page.locator('.card svg')).toContainText('Quality score')
  await page.getByLabel('Add filter').selectOption('custom:region')
  await page.getByRole('menuitemcheckbox', { name: 'West' }).click()
  await expect(page.locator('.card svg .mark-rect.role-mark path')).toHaveCount(1)
  await page.getByRole('tab', { name: 'Table view' }).click()
  await expect(page.getByRole('cell', { name: '0.5', exact: true })).toBeVisible()
})

test('conflicting artifact identities cannot replace pinned data', async ({ page }) => {
  const legacy = await (await page.request.get(`/results/harbor/${JOB}.json`)).json()
  const artifact = await adaptJobExportV1(legacy, `/results/harbor/${JOB}.json`)
  artifact.records[0].values.passed = 0
  artifact.contentHash = await contentHash(artifact)
  await page.locator('input[type=file]').setInputFiles({ name: 'conflicting.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(artifact)) })
  await expect(page.getByText(/already exists with different content/)).toBeVisible()
  await expect(page.getByLabel('Project sources').locator('input')).toHaveCount(1)
  await expect(page.locator('.card svg .mark-rect.role-mark path')).toHaveCount(4)
})


test('waits for a loaded analysis before opening presentation or spec editing', async ({ page }) => {
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/results/harbor/' + JOB + '.json', async (route) => {
    const response = await route.fetch()
    await held
    await route.fulfill({ response })
  })
  await page.goto('/studio?job=' + JOB)
  await expect(page.getByRole('tab', { name: 'Presentation', exact: true })).toBeDisabled()
  await expect(page.getByRole('tab', { name: 'Vega-Lite spec', exact: true })).toBeDisabled()
  release()
  await expect(page.getByRole('tab', { name: 'Presentation', exact: true })).toBeEnabled()
  await page.getByRole('tab', { name: 'Presentation', exact: true }).click()
  await page.getByRole('tab', { name: 'Poster', exact: true }).click()
  await expect(page.locator('#f-narrative-title')).toBeVisible()
})


test('presentation links require a bundle and interval controls follow the measure', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Copy link', exact: true })).toBeEnabled()
  await page.locator('#f-measure').selectOption('costUsd')
  await expect(page.getByLabel('95% intervals')).toHaveCount(0)
  await page.getByRole('tab', { name: 'Presentation', exact: true }).click()
  await page.getByRole('tab', { name: 'Poster', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Copy link', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Bundle', exact: true })).toBeEnabled()
})
