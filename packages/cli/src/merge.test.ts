import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { connectMerge, disconnectMerge, mergeAgent, mergeEnvironment, mergeHarnesses, mergePath, mergeStatus } from './merge'
import { loadProfiles, setupMergeProfiles, snapshotProfile } from './runner/profiles'
import { readJson, writeJson } from './runner/files'
import type { Catalog } from '../../../harbor/gateway/catalog'
import { supervise, type Outcome } from './runner/supervisor'

const directories: string[] = []
function state() { const path = mkdtempSync(join(tmpdir(), 'heval-merge-')); directories.push(path); return path }
afterEach(() => { directories.splice(0).forEach(p => rmSync(p, { recursive: true, force: true })) })
const model = 'anthropic/test-model'
const catalog: Catalog = { schemaVersion: 1, fetchedAt: '2026-09-20T00:00:00Z', source: 'test', models: [
  { model, displayName: 'Test', creator: 'anthropic', vendors: [{ vendor: 'test', status: 'available', supportsToolCalling: true, supportsReasoning: false, contextWindow: null, maxOutputTokens: null, inputPerMillion: null, outputPerMillion: null, cacheReadPerMillion: null }] },
] }
const bundledTask = resolve(import.meta.dirname, '../runner-task')

test('one validated key configures all four harnesses without secrets in profiles or snapshots', async () => {
  const directory = state()
  await connectMerge(directory, 'shared-secret', async () => catalog)
  expect(statSync(mergePath(directory)).mode & 0o777).toBe(0o600)
  const ids = setupMergeProfiles(directory, bundledTask, model, [...mergeHarnesses])
  expect(ids).toHaveLength(4)
  const profiles = loadProfiles(join(directory, 'profiles.json')).filter(p => p.mergeConnection)
  for (const profile of profiles) {
    expect(profile.public.model).toBe(model)
    expect(JSON.stringify(profile)).not.toContain('shared-secret')
    const run = state()
    snapshotProfile(profile, run)
    expect(readFileSync(join(run, 'harbor.json'), 'utf8')).not.toContain('shared-secret')
    expect(Object.values(mergeEnvironment(profile.mergeConnection!, profile.public.agent))).toEqual(['shared-secret'])
  }
  const before = profiles.map(p => p.public.digest)
  await connectMerge(directory, 'replacement-secret', async () => catalog)
  expect(loadProfiles(join(directory, 'profiles.json')).filter(p => p.mergeConnection).map(p => p.public.digest)).toEqual(before)
  expect(mergeEnvironment(mergePath(directory), 'codex')).toEqual({ OPENAI_API_KEY: 'replacement-secret' })
  expect(mergeEnvironment(mergePath(directory), 'claude-code')).toEqual({ ANTHROPIC_API_KEY: 'replacement-secret' })
  expect(JSON.stringify(mergeStatus(directory))).not.toContain('secret')
  disconnectMerge(directory)
  expect(mergeStatus(directory).connected).toBe(false)
  expect(() => mergeEnvironment(mergePath(directory), 'codex')).toThrow('Connect')
  expect(() => loadProfiles(join(directory, 'profiles.json'))).toThrow('Connect')
})

test('failed validation preserves the old connection without leaking upstream errors', async () => {
  const directory = state()
  await connectMerge(directory, 'old-key', async () => catalog)
  await expect(connectMerge(directory, 'new-key', async () => { throw new Error('upstream echoed new-key') })).rejects.toThrow('saved key has not changed')
  expect(mergeEnvironment(mergePath(directory), 'pi')).toEqual({ OPENAI_API_KEY: 'old-key' })
  await expect(connectMerge(directory, 'x\nINJECTED=y', async () => catalog)).rejects.toThrow('whitespace')
  await expect(connectMerge(directory, 'new-key', async () => ({ ...catalog, models: [] }))).rejects.toThrow('No available')
})

test('routing preserves the full gateway model ID and uses Harbor adapter-specific settings', () => {
  expect(mergeAgent('codex', model)).toMatchObject({ model_name: model, env: { OPENAI_BASE_URL: 'https://api-gateway.merge.dev/v1/openai' }, kwargs: { config: { model_provider: 'merge-gateway', model_providers: { 'merge-gateway': { supports_websockets: false, wire_api: 'responses', env_key: 'OPENAI_API_KEY' } } } } })
  expect(mergeAgent('claude-code', model)).toMatchObject({ model_name: model, env: { ANTHROPIC_BASE_URL: 'https://api-gateway.merge.dev/v1/anthropic' } })
  expect(mergeAgent('opencode', model).model_name.split('/').slice(1).join('/')).toBe(model)
  expect(mergeAgent('pi', model)).toMatchObject({ model_name: `openai/${model}`, kwargs: { model_api: 'openai-completions', version: '0.84.4' } })
  expect(() => mergeAgent('unknown', model)).toThrow('Merge supports')
})

test('setup rejects unavailable models, duplicate profiles and routing overrides', async () => {
  const directory = state()
  await connectMerge(directory, 'key', async () => catalog)
  expect(() => setupMergeProfiles(directory, bundledTask, 'unknown', ['codex'])).toThrow('choose a model')
  setupMergeProfiles(directory, bundledTask, model, ['codex'])
  expect(() => setupMergeProfiles(directory, bundledTask, model, ['codex', 'pi'])).toThrow('already exists')
  const configPath = join(directory, 'merge-codex.json')
  const config = readJson<{ agents: Record<string, unknown>[] }>(configPath)
  config.agents[0].env = { OPENAI_BASE_URL: 'https://other.invalid' }
  writeJson(configPath, config)
  expect(() => loadProfiles(join(directory, 'profiles.json'))).toThrow('automatically')
})

test('supervisor injects the shared key into each harness process without putting it in artifacts', async () => {
  const directory = state()
  await connectMerge(directory, 'process-test-key', async () => catalog)
  setupMergeProfiles(directory, bundledTask, model, [...mergeHarnesses])
  const fake = join(directory, 'fake-harbor')
  writeFileSync(fake, `#!/usr/bin/env node
const fs = require('node:fs');
const config = JSON.parse(fs.readFileSync('harbor.json'));
const agent = config.agents[0];
const key = agent.name === 'claude-code' ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY;
if (key !== 'process-test-key') process.exit(1);
if (agent.name === 'claude-code' ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY) process.exit(2);
fs.mkdirSync('jobs/evaluation/trial', {recursive:true});
fs.writeFileSync('jobs/evaluation/trial/config.json', JSON.stringify({agent}));
fs.writeFileSync('jobs/evaluation/trial/result.json', JSON.stringify({task_name:'heval-setup', verifier_result:{rewards:{reward:1}}, agent_info:{name:agent.name, version:'test'}}));
`, { mode: 0o700 })
  const signals = process.listenerCount('SIGINT')
  for (const profile of loadProfiles(join(directory, 'profiles.json')).filter(p => p.mergeConnection)) {
    const run = state()
    snapshotProfile(profile, run)
    writeJson(join(run, 'execution.json'), { claimId: 'test', harbor: fake, timeoutSeconds: 10, mergeConnection: profile.mergeConnection })
    await supervise(run)
    const outcome = readJson<Outcome>(join(run, 'outcome.json'))
    expect(outcome.status).toBe('completed')
    expect(JSON.stringify(outcome)).not.toContain('process-test-key')
    expect(readFileSync(join(run, 'harbor.json'), 'utf8')).not.toContain('process-test-key')
    expect(readFileSync(join(run, 'execution.json'), 'utf8')).not.toContain('process-test-key')
  }
  expect(process.listenerCount('SIGINT')).toBe(signals)
})
