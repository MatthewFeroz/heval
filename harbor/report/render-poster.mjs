import { readFileSync } from 'node:fs'
import { chromium } from 'playwright'

const { htmlPath, pngPath, width, height } = JSON.parse(readFileSync(0, 'utf8'))
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 })
  await page.setContent(readFileSync(htmlPath, 'utf8'), { waitUntil: 'load' })
  await page.evaluate(() => document.fonts.ready)
  const layout = await page.evaluate(() => window.__hevalLayoutReady)
  if (layout?.errors.length) throw new Error('Layout check failed: ' + layout.errors.join('; '))
  await page.screenshot({ path: pngPath, type: 'png' })
} finally {
  await browser.close()
}
