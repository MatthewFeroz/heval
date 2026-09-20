import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { emitKeypressEvents } from 'node:readline'
import { fetchCatalog, type Catalog } from '../../../harbor/gateway/catalog'
import { readJson, writeJson } from './runner/files'

export const mergeHarnesses = ['codex', 'claude-code', 'opencode', 'pi'] as const
export type MergeHarness = typeof mergeHarnesses[number]
type Connection = { key: string; models: string[]; validatedAt: string }
const openai = 'https://api-gateway.merge.dev/v1/openai'
const anthropic = 'https://api-gateway.merge.dev/v1/anthropic'
export const mergePath = (directory: string) => join(directory, 'merge.json')

export async function connectMerge(directory: string, raw: string, catalog: (key: string) => Promise<Catalog> = fetchCatalog) {
  const key = raw.trim()
  if (!key || key.length > 4096 || /\s/.test(key)) throw new Error('Enter a nonempty Merge Gateway key without whitespace.')
  let result: Catalog
  try { result = await catalog(key) }
  catch { throw new Error('Merge catalog validation failed. Check your key and connection; the saved key has not changed.') }
  const models = [...new Set(result.models.filter(m => m.vendors.some(v => v.status === 'available' && v.supportsToolCalling)).map(m => m.model))]
  if (!models.length) throw new Error('No available tool-calling models. The saved connection has not changed.')
  writeJson(mergePath(directory), { key, models, validatedAt: result.fetchedAt })
  return mergeStatus(directory)
}
export function mergeStatus(directory: string) {
  if (!existsSync(mergePath(directory))) return { connected: false, models: [] as string[] }
  const saved = readJson<Connection>(mergePath(directory))
  return { connected: true, models: saved.models, validatedAt: saved.validatedAt }
}
export function disconnectMerge(directory: string) { rmSync(mergePath(directory), { force: true }) }

/** Harbor creates each harness's settings inside its evaluation container. */
export function mergeAgent(harness: string, model: string) {
  if (!mergeHarnesses.includes(harness as MergeHarness)) throw new Error(`Merge supports: ${mergeHarnesses.join(', ')}.`)
  if (!model || /\s/.test(model)) throw new Error('Select an exact Merge model ID.')
  const versions = { codex: '0.151.0', 'claude-code': '2.1.251', opencode: '1.18.25', pi: '0.84.4' }
  const kwargs: Record<string, unknown> = { version: versions[harness as MergeHarness] }
  if (harness === 'codex') kwargs.config = {
    model_provider: 'merge-gateway',
    model_providers: { 'merge-gateway': { name: 'Merge Gateway', base_url: openai, env_key: 'OPENAI_API_KEY', wire_api: 'responses', supports_websockets: false } },
  }
  if (harness === 'pi') kwargs.model_api = 'openai-completions'
  // Harbor's passthrough adapters split the first provider prefix. Preserve
  // the complete Merge slug as the model sent on the wire.
  const model_name = harness === 'pi' || harness === 'opencode' ? `openai/${model}` : model
  return { name: harness, model_name, kwargs, env: harness === 'claude-code'
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
