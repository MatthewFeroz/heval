import { expect, test, type Page } from '@playwright/test'

const JOB = 'terminal-bench-glm53-smoke'
async function testSession(page: Page) {
  await page.route(url => /^\/studio(?:\.html)?$/.test(url.pathname), async route => {
    const response = await route.fetch({ url: new URL('/tests/fixtures/studio-auth.html', route.request().url()).href })
    await route.fulfill({ response })
  })
}

function observeStudioRequests(page: Page) {
  const requests: string[] = []
  page.on('request', request => {
    if (/\/results\/harbor\/|\/api\/runs|\/src\/studio\/(StudioWorkspace|Studio)\.tsx|\.convex\.cloud/.test(request.url())) requests.push(request.url())
  })
  return requests
}

test('all Studio entry points stay closed when sign-in is unconfigured', async ({ page }) => {
  const requests = observeStudioRequests(page)
  for (const path of ['/studio', '/studio.html', `/studio?job=${JOB}`, '/studio?runs=private-attempt', '/studio?report=private-report']) {
    await page.goto(path)
    await expect(page.getByRole('heading', { name: 'Sign in to Studio' })).toBeVisible()
    await expect(page.getByRole('status')).toContainText('Sign-in isn’t available')
    await expect(page.getByRole('button', { name: 'Open export' })).toHaveCount(0)
    await expect(page.locator('.studio')).toHaveCount(0)
    await expect(page.locator('input[type=file]')).toHaveCount(0)
  }
  expect(requests).toEqual([])
})

test('signed-out users cannot load either editor and retain the requested URL', async ({ page }) => {
  await testSession(page)
  const requests = observeStudioRequests(page)
  for (const path of [`/studio?job=${JOB}&recipe=scatter&color=none#chart`, '/studio.html?runs=private-attempt#trial', '/studio?report=private-report#draft']) {
    await page.goto(path)
    await expect(page.getByRole('heading', { name: 'Sign in to Studio' })).toBeVisible()
    await page.getByRole('button', { name: 'Sign in to Studio', exact: true }).click()
    await expect(page.getByLabel('Requested sign-in destination')).toHaveText(path)
    await expect(page.locator('.studio')).toHaveCount(0)
    expect(new URL(page.url()).pathname + new URL(page.url()).search + new URL(page.url()).hash).toBe(path)
  }
  expect(requests).toEqual([])
})

test('waits for session verification before mounting Studio, then removes it on sign-out', async ({ page }) => {
  await testSession(page)
  const requests = observeStudioRequests(page)
  await page.goto(`/studio?job=${JOB}&authState=loading`)
  await expect(page.getByRole('heading', { name: 'Checking your session…' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in to Studio', exact: true })).toHaveCount(0)
  await expect(page.locator('.studio')).toHaveCount(0)
  expect(requests).toEqual([])

  await page.getByRole('button', { name: 'Complete test sign-in' }).click()
  await expect(page.getByRole('heading', { name: JOB })).toBeVisible()
  await expect(page.locator('.card svg')).toBeVisible()
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Sign in to Studio' })).toBeVisible()
  await expect(page.locator('.studio')).toHaveCount(0)
})

test('opens the requested chart after sign-in and closes it if the session expires', async ({ page }) => {
  await testSession(page)
  await page.goto(`/studio?job=${JOB}&recipe=scatter&x=agent&color=none&measure=passed#chart`)
  await page.getByRole('button', { name: 'Sign in to Studio', exact: true }).click()
  await page.getByRole('button', { name: 'Complete test sign-in' }).click()
  await expect(page.getByRole('heading', { name: JOB })).toBeVisible()
  await expect(page.locator('#f-recipe')).toHaveValue('scatter')
  await expect(page.locator('#f-color')).toHaveValue('none')
  await page.getByRole('button', { name: 'Expire test session' }).click()
  await expect(page.getByRole('heading', { name: 'Sign in to Studio' })).toBeVisible()
  await expect(page.locator('.studio')).toHaveCount(0)
})

test('failed sign-in stays closed and offers a retry', async ({ page }) => {
  await testSession(page)
  const requests = observeStudioRequests(page)
  await page.goto(`/studio?job=${JOB}&authError=1`)
  await page.getByRole('button', { name: 'Sign in to Studio', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText('Couldn’t open sign-in. Please try again.')
  await expect(page.getByRole('button', { name: 'Sign in to Studio', exact: true })).toBeEnabled()
  await expect(page.locator('.studio')).toHaveCount(0)
  expect(requests).toEqual([])
})
