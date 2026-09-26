import { expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import harnessCatalog from '../../../src/harness-catalog.json'
import { mergeAgent, mergeHarnesses, selectMergeHarnesses } from './merge'
import { providerPage, renderProviderPage } from './provider-page'

test('the homepage catalog supplies packaged icons and setup offers only supported harnesses', () => {
  expect(harnessCatalog).toHaveLength(9)
  expect(selectMergeHarnesses(['all'])).toEqual([...mergeHarnesses])
  for (const harness of harnessCatalog) {
    expect(existsSync(resolve(import.meta.dirname, '../../../public/harnesses', harness.logo))).toBe(true)
    expect(providerPage.includes(`name="harness" value="${harness.id}"`)).toBe(harness.merge)
  }
  expect(harnessCatalog.filter(h => h.merge).map(h => h.id).sort()).toEqual([...mergeHarnesses].sort())
})

test('selection is explicit, rejects unavailable adapters, and preselects only requested harnesses', () => {
  expect(selectMergeHarnesses(['codex', 'pi'])).toEqual(['codex', 'pi'])
  for (const value of [[], ['codex', 'codex'], ['all', 'pi'], ['../other'], ['deepseek'], ['cursor'], ['antigravity']]) expect(() => selectMergeHarnesses(value)).toThrow()
  const page = renderProviderPage(['pi'])
  expect(page).toContain('value="pi" checked')
  expect(page).not.toContain('value="codex" checked')
  expect(page).not.toContain('/api/install')
})

test('Grok pins primary and auxiliary calls to the same Merge model; Deep Agents uses only its bundled adapter', () => {
  const model = 'deepseek/deepseek-v4.1-flash'
  expect(mergeAgent('grok-build', model)).toMatchObject({ model_name: `openai/${model}`, kwargs: { version: '1.0.34', grok_config: {
    models: { default: model, session_summary: model, image_description: model, web_search: model },
    model: { [model]: { base_url: 'https://api-gateway.merge.dev/v1/openai', env_key: 'OPENAI_API_KEY', api_backend: 'chat_completions' } },
  } } })
  expect(mergeAgent('deep-agents', model)).toMatchObject({ import_path: 'heval_agents:DeepAgents', model_name: model, kwargs: { version: '0.1.70' } })
  for (const id of ['deepseek', 'cursor', 'antigravity']) expect(() => mergeAgent(id, model)).toThrow('Merge supports')
})
