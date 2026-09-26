import shortlist from '../../../src/runners/model-shortlist.json'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { emitKeypressEvents } from 'node:readline'
import { fetchCatalog, type Catalog } from '../../../harbor/gateway/catalog'
import { readJson, writeJson } from './runner/files'
import catalog from '../../../src/harness-catalog.json'

export const mergeHarnesses = ['codex', 'claude-code', 'opencode', 'pi', 'grok-build', 'deep-agents'] as const
export type MergeHarness = typeof mergeHarnesses[number]
export function selectMergeHarnesses(selection: string[]) {
  const ids = selection.length === 1 && selection[0] === 'all' ? [...mergeHarnesses] : selection
  if (!ids.length || new Set(ids).size !== ids.length) throw new Error('Choose at least one unique harness.')
  for (const id of ids) if (!mergeHarnesses.includes(id as MergeHarness)) {
    const entry = catalog.find(h => h.id === id)
    throw new Error(entry?.reason ?? `Choose supported harnesses from: ${mergeHarnesses.join(', ')}.`)
  }
  return ids
}
type Connection = { key: string; models: string[]; catalog?: Catalog['models']; validatedAt: string }
const openai = 'https://api-gateway.merge.dev/v1/openai'
const anthropic = 'https://api-gateway.merge.dev/v1/anthropic'
export const mergePath = (directory: string) => join(directory, 'merge.json')

export async function connectMerge(directory: string, raw: string, catalog: (key: string) => Promise<Catalog> = fetchCatalog) {
  const key = raw.trim()
  if (!key || key.length > 4096 || /\s/.test(key)) throw new Error('Enter a nonempty Merge Gateway key without whitespace.')
  let result: Catalog
  try { result = await catalog(key) }
  catch { throw new Error('Merge catalog validation failed. Check your key and connection; the saved key has not changed.') }
  const available = result.models.map(m => ({ ...m, vendors: m.vendors.filter(v => v.status === 'available' && v.supportsToolCalling) })).filter(m => m.vendors.length)
  const models = [...new Set(available.map(m => m.model))]
  if (!models.length) throw new Error('No available tool-calling models. The saved connection has not changed.')
  writeJson(mergePath(directory), { key, models, catalog: available, validatedAt: result.fetchedAt })
  return mergeStatus(directory)
}
export function mergeStatus(directory: string) {
  if (!existsSync(mergePath(directory))) return { connected: false, models: [] as string[] }
  const saved = readJson<Connection>(mergePath(directory))
  return { connected: true, models: saved.models, catalog: saved.catalog ?? [], validatedAt: saved.validatedAt }
}
export function publicMergeCatalog(directory: string) {
  const connection = mergeStatus(directory)
  if (!connection.connected || !connection.catalog?.length) return null
  return { fetchedAt: connection.validatedAt!, models: connection.catalog.filter(m => shortlist.some(s => s.id === m.model)) }
}
export function disconnectMerge(directory: string) { rmSync(mergePath(directory), { force: true }) }

/** Harbor creates each harness's settings inside its evaluation container. */
export function mergeAgent(harness: string, model: string) {
  if (!mergeHarnesses.includes(harness as MergeHarness)) throw new Error(`Merge supports: ${mergeHarnesses.join(', ')}.`)
  if (!model || /\s/.test(model)) throw new Error('Select an exact Merge model ID.')
  const kwargs: Record<string, unknown> = { version: catalog.find(h => h.id === harness)!.version }
  if (harness === 'codex') kwargs.config = {
    model_provider: 'merge-gateway',
    model_providers: { 'merge-gateway': { name: 'Merge Gateway', base_url: openai, env_key: 'OPENAI_API_KEY', wire_api: 'responses', supports_websockets: false } },
  }
  if (harness === 'pi') kwargs.model_api = 'openai-completions'
  if (harness === 'grok-build') kwargs.grok_config = {
    models: { default: model, session_summary: model, image_description: model, web_search: model },
    model: { [model]: { name: model, model, base_url: openai, env_key: 'OPENAI_API_KEY', api_backend: 'chat_completions' } },
  }
  // Harbor's passthrough adapters split the first provider prefix. Preserve
  // the complete Merge slug as the model sent on the wire.
  const model_name = ['pi', 'opencode', 'grok-build'].includes(harness) ? `openai/${model}` : model
  return { name: harness, ...(harness === 'deep-agents' ? { import_path: 'heval_agents:DeepAgents' } : {}), model_name, kwargs, env: harness === 'claude-code'
    ? { ANTHROPIC_BASE_URL: anthropic }
    : { OPENAI_BASE_URL: openai } }
}

/** Resolve secrets only at launch; never place keys in profiles or run JSON. */
export function mergeEnvironment(file: string, harness: string): Record<string, string> {
  if (!mergeHarnesses.includes(harness as MergeHarness)) throw new Error('Unsupported Merge harness.')
  if (!existsSync(file)) throw new Error('Connect Merge Gateway before launching this evaluation.')
  const { key } = readJson<Connection>(file)
  if (!key || /\s/.test(key)) throw new Error('Invalid saved Merge connection. Connect again.')
  return harness === 'claude-code' ? { ANTHROPIC_API_KEY: key } : { OPENAI_API_KEY: key }
}

export async function readMergeKey(fromStdin: boolean) {
  if (fromStdin) {
    let text = ''
    for await (const chunk of process.stdin) {
      text += chunk.toString()
      if (text.length > 4098) throw new Error('Merge key input is too long.')
    }
    return text
  }
  if (!process.stdin.isTTY) throw new Error('Use an interactive terminal or --key-stdin. Never pass the key as an argument.')
  const input = process.stdin
  const wasRaw = input.isRaw
  process.stderr.write('Merge Gateway key (hidden): ')
  emitKeypressEvents(input)
  input.setRawMode(true)
  input.resume()
  return new Promise<string>((resolve, reject) => {
    let value = ''
    const finish = (error?: Error) => {
      input.removeListener('keypress', onKey)
      input.setRawMode(wasRaw)
      input.pause()
      process.stderr.write('\n')
      if (error) reject(error); else resolve(value)
    }
    const onKey = (text: string | undefined, key: { name?: string; ctrl?: boolean; meta?: boolean }) => {
      if (key.ctrl && (key.name === 'c' || key.name === 'd')) return finish(new Error('Connection cancelled.'))
      if (key.name === 'return' || key.name === 'enter') return finish()
      if (key.name === 'backspace') { value = value.slice(0, -1); return }
      if (text && !key.ctrl && !key.meta && [...text].every(c => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127)) value += text
      if (value.length > 4096) finish(new Error('Merge key input is too long.'))
    }
    input.on('keypress', onKey)
  })
}
