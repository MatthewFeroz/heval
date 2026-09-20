import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, statSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { cloudUrl } from './client'
import { initializeProfiles, loadProfiles, snapshotProfile, requestedProfile } from './profiles'
import { readJson, writeJson } from './files'
import { processKey } from './supervisor'
import { exportJob } from '../../../../harbor/report/trials'

const temporary: string[] = []
const task = resolve(import.meta.dirname, '../../runner-task')
function state() { const dir = mkdtempSync(join(tmpdir(), 'heval-runner-')); temporary.push(dir); return dir }
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }) })
test('pairing refuses credential-bearing URLs, insecure origins and unrelated hosts', () => {
  expect(cloudUrl('https://example.convex.cloud')).toBe('https://example.convex.cloud')
  for (const url of ['http://example.convex.cloud', 'https://example.com', 'https://example.convex.cloud.evil.test', 'https://secret@example.convex.cloud', 'https://example.convex.cloud/?secret=x', 'https://example.convex.cloud/api']) expect(() => cloudUrl(url)).toThrow()
})
test('matching profiles are portable across machines and changes alter the content digest', () => {
  const a = state(), b = state()
  const one = loadProfiles(initializeProfiles(a, task))[0], two = loadProfiles(initializeProfiles(b, task))[0]
  expect(one.public.digest).toBe(two.public.digest)
  writeFileSync(join(b, 'tasks/heval-setup/instruction.md'), 'Changed task')
  expect(loadProfiles(join(b, 'profiles.json'))[0].public.digest).not.toBe(one.public.digest)
  expect(JSON.stringify(one.public)).not.toContain(a)
})
test('snapshot isolates execution from later edits while preserving task names', () => {
  const dir = state(), target = state()
  const profile = loadProfiles(initializeProfiles(dir, task))[0]
  snapshotProfile(profile, target)
  const config = readJson<{ tasks: { path: string }[]; n_concurrent_trials: number; retry: { max_retries: number } }>(join(target, 'harbor.json'))
  expect(config.tasks[0].path.endsWith('/heval-setup')).toBe(true)
  expect(config.n_concurrent_trials).toBe(1)
  expect(config.retry.max_retries).toBe(0)
  const instruction = join(config.tasks[0].path, 'instruction.md')
  const before = readFileSync(instruction, 'utf8')
  writeFileSync(join(dir, 'tasks/heval-setup/instruction.md'), 'Changed later')
  expect(readFileSync(instruction, 'utf8')).toBe(before)
  expect(() => snapshotProfile(profile, state())).toThrow('changed')
})
test('profile approval rejects implicit datasets, multiple agents, symlinks and excess attempts', () => {
  const dir = state(), registry = initializeProfiles(dir, task)
  const original = readJson<Record<string, unknown>>(join(dir, 'setup.json'))
  for (const change of [{ datasets: [{ name: 'latest' }] }, { agents: [{ name: 'oracle' }, { name: 'codex' }] }, { agents: [{ import_path: 'arbitrary' }] }, { n_attempts: 100 }]) {
    writeJson(join(dir, 'setup.json'), { ...original, ...change })
    expect(() => loadProfiles(registry)).toThrow()
  }
  writeJson(join(dir, 'setup.json'), original)
  symlinkSync('/etc/passwd', join(dir, 'tasks/heval-setup/leak'))
  expect(() => loadProfiles(registry)).toThrow('symlinks')
})
test('runner state writes use private file permissions and process identity includes a live start time', () => {
  const path = join(state(), 'connection.json')
  writeJson(path, { credential: 'private' })
  expect(statSync(path).mode & 0o777).toBe(0o600)
  expect(processKey(process.pid)).not.toBeNull()
  expect(processKey(99999999)).toBeNull()
})
test('Harbor default-elided configs import the resolved Oracle agent from results', () => {
  const directory = state(), trial = join(directory, 'trial')
  writeJson(join(trial, 'config.json'), { trial_name: 'trial' })
  writeJson(join(trial, 'result.json'), { task_name: 'setup', config: { agent: { name: 'oracle' } }, verifier_result: { rewards: { reward: 1 } }, agent_info: { name: 'oracle', version: '1.0.0' } })
  expect(exportJob(directory, null).rows).toMatchObject([{ agent: 'oracle', reward: 1, passed: 1 }])
})

test('Codex, Claude Code and Pi profiles retain reviewed provider settings', () => {
  const dir = state(), registry = initializeProfiles(dir, task)
  for (const name of ['codex', 'claude-code', 'pi']) {
    const agent = { name, model_name: 'deepseek/deepseek-v4.1-flash', kwargs: { version: 'test-pin', ...(name === 'pi' ? { model_api: 'openai-completions' } : {}) }, env: { DEEPSEEK_BASE_URL: 'http://worker:8787/v1/openai' } }
    writeJson(join(dir, 'setup.json'), { n_attempts: 1, agents: [agent], tasks: [{ path: 'tasks/heval-setup' }] })
    const profile = loadProfiles(registry)[0]
    expect(profile.public.agent).toBe(name)
    expect(profile.config.agents).toEqual([agent])
    expect(profile.public.setupCheck).toBe(false)
  }
})

test('browser attempts stay within worker approval and retain a stable task identity', () => {
  const dir = state(), registry = initializeProfiles(dir, task)
  const doc = readJson<{ profiles: { maxAttempts?: number }[] }>(registry)
  doc.profiles[0].maxAttempts = 3
  writeJson(registry, doc)
  const profile = loadProfiles(registry)[0]
  expect(profile.public.maxAttempts).toBe(3)
  expect(profile.public.taskSet).toMatch(/^[a-f0-9]{64}$/)
  const requested = requestedProfile(profile, 2)
  const run = join(dir, 'two-attempt-run')
  snapshotProfile(requested, run)
  expect(readJson<{n_attempts:number}>(join(run,'harbor.json')).n_attempts).toBe(2)
  expect(profile.config.n_attempts).toBe(1)
  expect(() => requestedProfile(profile, 4)).toThrow('approval')
  expect(() => requestedProfile(profile, 0)).toThrow('approval')
  expect(() => requestedProfile(profile, 1.5)).toThrow('approval')
  doc.profiles[0].maxAttempts = 2
  writeJson(registry, doc)
  expect(loadProfiles(registry)[0].public.digest).not.toBe(profile.public.digest)
})
