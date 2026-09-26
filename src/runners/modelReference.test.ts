import { expect, test } from 'bun:test'
import { formatPrice, lowestRoute } from './modelReference'
import type { VendorRoute } from './gatewayCatalog'
const route = (vendor: string, input: number | null, output: number | null, status = 'available'): VendorRoute => ({ vendor, inputPerMillion: input, outputPerMillion: output, status, cacheReadPerMillion: null, contextWindow: null, maxOutputTokens: null, supportsToolCalling: true, supportsReasoning: false })
test('Merge from-prices keep one available route and preserve missing and zero costs', () => {
  expect(lowestRoute([route('unavailable', 0, 0, 'unavailable'), route('incomplete', null, 1), route('a', 1, 10), route('b', 2, 3)])).toMatchObject({ vendor: 'a', inputPerMillion: 1, outputPerMillion: 10 })
  expect(lowestRoute([route('free', 0, 0)])?.vendor).toBe('free')
  expect(lowestRoute([route('unknown', null, null)])).toBeUndefined()
  expect(formatPrice(null)).toBe('—')
  expect(formatPrice(0)).toBe('$0')
  expect(formatPrice(.015)).toBe('$0.015')
})

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ModelDetails } from './ModelDetails'
test('the detail cards price the selected provider, not a cheaper competing route', () => {
  const props = { model: { model: 'test/model', displayName: 'Test', creator: 'Test', vendors: [route('cheap', 1, 2), route('selected', 9, 18)] }, name: 'Test', summary: '', group: 'Test', checkedAt: '2026-09-25', vendor: 'selected' }
  const html = renderToStaticMarkup(createElement(ModelDetails, props))
  expect(html).toContain('<dd>$9</dd>')
  expect(html).toContain('<dd>$18</dd>')
  expect(html).not.toContain('Starting rates via cheap')
})
test('an absent selected provider keeps missing prices instead of substituting a cheaper route', () => {
  const props = { model: { model: 'test/model', displayName: 'Test', creator: 'Test', vendors: [route('cheap', 1, 2)] }, name: 'Test', summary: '', group: 'Test', checkedAt: '2026-09-25', vendor: 'missing' }
  const html = renderToStaticMarkup(createElement(ModelDetails, props))
  expect(html).not.toContain('<dd>$1</dd>')
  expect(html).toContain('<dd>—</dd>')
  expect(html).toContain('Rates for missing.')
})

import { modelCatalogEntry } from './publicModelCatalog'
import shortlist from './model-shortlist.json'
test('all eleven models have public prices without a connected account', () => {
  for (const item of shortlist) {
    const entry = modelCatalogEntry(item.id, null)!
    expect(entry.sourceUrl).toStartWith('https://docs.merge.dev/merge-gateway/models/details/')
    expect(lowestRoute(entry.model.vendors)?.inputPerMillion).toBeNumber()
    expect(lowestRoute(entry.model.vendors)?.outputPerMillion).toBeNumber()
  }
  expect(lowestRoute(modelCatalogEntry('openai/gpt-6-astra')!.model.vendors)).toMatchObject({ inputPerMillion: 10, outputPerMillion: 50 })
  expect(lowestRoute(modelCatalogEntry('anthropic/claude-opus-5-5')!.model.vendors)).toMatchObject({ inputPerMillion: 4, outputPerMillion: 20 })
})
test('stale connections cannot erase public rates; newer connected catalogs take precedence', () => {
  const model = modelCatalogEntry('openai/gpt-6-astra')!.model
  const connected = { fetchedAt: '2020-01-01T00:00:00Z', models: [{...model, vendors:[route('openai', 99, 100)]}] }
  expect(modelCatalogEntry(model.model, connected)?.sourceUrl).toBeTruthy()
  connected.fetchedAt = '2099-01-01T00:00:00Z'
  expect(modelCatalogEntry(model.model, connected)?.sourceUrl).toBeUndefined()
  expect(modelCatalogEntry(model.model, connected)?.model.vendors[0].inputPerMillion).toBe(99)
})
