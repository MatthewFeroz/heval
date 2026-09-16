import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { prepareLaunch } from './worker/launch'

const names = ['HEVAL_PROVIDER', 'HEVAL_GATEWAY_API_KEY', 'HEVAL_GATEWAY_MODEL', 'HEVAL_VENDOR_PINS_JSON']
const original = Object.fromEntries(names.map(name => [name, process.env[name]]))
const directories: string[] = []
afterEach(async () => {
  for (const name of names) {
    if (original[name] === undefined) delete process.env[name]
    else process.env[name] = original[name]
  }
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

test('Pi selects the requested Merge model and vendor without writing the key to its model file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'heval-launch-test-')); directories.push(directory)
  process.env.HEVAL_PROVIDER = 'merge-gateway'
  process.env.HEVAL_GATEWAY_API_KEY = 'fake-test-credential'
  process.env.HEVAL_GATEWAY_MODEL = 'nvidia/nemotron-super-3-120b'
  process.env.HEVAL_VENDOR_PINS_JSON = JSON.stringify({ 'nvidia/nemotron-super-3-120b': 'bedrock' })
  const launch = prepareLaunch('pi-agent', directory)
  expect(launch.command).toContain('--print')
  expect(launch.command).toContain('merge-gateway/nvidia/nemotron-super-3-120b')
  const text = await readFile(join(directory, '.heval/pi/models.json'), 'utf8')
  expect(text).not.toContain('fake-test-credential')
  expect(JSON.parse(text).providers['merge-gateway'].models[0].samplingParams.vendor).toBe('bedrock')
})

test('direct NVIDIA uses the Chat Completions endpoint and rejects unsupported harnesses', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'heval-launch-test-')); directories.push(directory)
  process.env.HEVAL_PROVIDER = 'nvidia'
  process.env.HEVAL_GATEWAY_API_KEY = 'fake-test-credential'
  process.env.HEVAL_GATEWAY_MODEL = 'nvidia/nemotron-3.5-lightning-30b-a3b'
  process.env.HEVAL_VENDOR_PINS_JSON = '{}'
  const launch = prepareLaunch('pi-agent', directory)
  expect(launch.command).toContain('nvidia/nvidia/nemotron-3.5-lightning-30b-a3b')
  const provider = JSON.parse(await readFile(join(directory, '.heval/pi/models.json'), 'utf8')).providers.nvidia
  expect(provider.baseUrl).toBe('https://integrate.api.nvidia.com/v1')
  expect(provider.api).toBe('openai-completions')
  expect(provider.compat.supportsDeveloperRole).toBe(false)
  expect(() => prepareLaunch('claude-code', directory)).toThrow('requires Pi')
})
