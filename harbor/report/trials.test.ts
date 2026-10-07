import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { exportJob, readTrial } from './trials'
import { mergeJobs } from './merge-jobs'
import type { Catalog } from '../gateway/catalog'

const roots: string[] = []
function fixture(agent: object = { import_path: 'smoke_adapters:DeepSeekHarness', kwargs: { thinking: 'enabled', api_key: 'secret' } }, base = tmpdir()) {
  const root = mkdtempSync(join(base, 'harbor-export-'))
  roots.push(root)
  const dir = join(root, 'trial')
  mkdirSync(dir)
  writeFileSync(join(dir, 'result.json'), JSON.stringify({
    id: 'trial-id', trial_name: 'same-name', task_name: 'protocol-smoke', task_checksum: 'checksum',
    config: { agent }, agent_info: { name: 'deepseek-harness', version: 'test-version' },
    verifier_result: { rewards: { reward: 1 } },
  }))
  return { root, dir }
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('Harbor exports', () => {
  test('exports custom agents using resolved result-only config without leaking credentials', () => {
    const { root } = fixture()
    const job = exportJob(root, null)
    expect(job.rows).toHaveLength(1)
    expect(job.rows[0]).toMatchObject({ agent: 'deepseek-harness', thinking: 'enabled', reward: 1, inputTokens: null, costUsd: null, trialId: 'trial-id' })
    expect(JSON.stringify(job)).not.toContain('secret')
  })
  test('records the job path relative to the home directory', () => {
    const { root } = fixture(undefined, homedir())
    const job = exportJob(root, null)
    expect(job.source).toStartWith('~/')
    expect(JSON.stringify(job)).not.toContain(homedir())
  })
  test('uses import path when custom agent has no observed name', () => {
    const { dir } = fixture()
    writeFileSync(join(dir, 'result.json'), JSON.stringify({ config: { agent: { import_path: 'custom:Agent' } } }))
    expect(readTrial(dir, null)?.agent).toBe('custom:Agent')
  })
  test('preserves built-in agent and explicit model config', () => {
    const { dir } = fixture()
    writeFileSync(join(dir, 'result.json'), JSON.stringify({ config: { agent: { name: 'codex', model_name: 'old' } } }))
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ agent: { model_name: 'deepseek/flash' } }))
    expect(readTrial(dir, null)).toMatchObject({ agent: 'codex', model: 'deepseek/flash', provider: 'deepseek' })
  })
  test('Merge transport prefixes preserve the selected model identity and pinned pricing', () => {
    const model = 'zai/glm-5.3', env = { OPENAI_BASE_URL: 'https://api-gateway.merge.dev/v1/openai', HEVAL_VENDOR: 'zai' }
    const catalog: Catalog = { schemaVersion: 1, fetchedAt: '2026-10-04T00:00:00Z', source: 'test', models: [{
      model, displayName: 'GLM', creator: 'zai', vendors: [{ vendor: 'zai', status: 'available', supportsToolCalling: true, supportsReasoning: false, contextWindow: null, maxOutputTokens: null, inputPerMillion: 1, outputPerMillion: 2, cacheReadPerMillion: null }],
    }] }
    for (const name of ['pi', 'opencode', 'grok-build']) {
      // Older/default-elided Harbor artifacts may retain only the resolved config.
      const { dir } = fixture({ name, model_name: `openai/${model}`, env })
      writeFileSync(join(dir, 'result.json'), JSON.stringify({ config: { agent: { name, model_name: `openai/${model}`, env } }, agent_result: { n_input_tokens: 100, n_output_tokens: 50 }, verifier_result: { rewards: { reward: 1 } } }))
      expect(readTrial(dir, catalog)).toMatchObject({ model, modelShort: 'glm-5.3', provider: 'zai', costUsd: 0.0002, costSource: 'derived' })
    }
  })
  test('unknown routing and ordinary OpenAI or custom model IDs remain unchanged', () => {
    const merge = { OPENAI_BASE_URL: 'https://api-gateway.merge.dev/v1/openai' }
    for (const agent of [
      { name: 'pi', model_name: 'openai/zai/glm-5.3' },
      { name: 'opencode', model_name: 'openai/zai/glm-5.3', env: { OPENAI_BASE_URL: 'https://api.openai.com/v1' } },
      { name: 'grok-build', model_name: 'openai/zai/glm-5.3', env: { OPENAI_BASE_URL: 'https://api-gateway.merge.dev.evil.test/v1/openai' } },
      { name: 'pi', model_name: 'openai/zai/glm-5.3', env: { OPENAI_BASE_URL: 'http://worker:8787/v1/openai', HEVAL_VENDOR: 'zai' } },
      { name: 'custom', model_name: 'openai/zai/glm-5.3', env: merge },
      { name: 'pi', import_path: 'custom:Agent', model_name: 'openai/zai/glm-5.3', env: merge },
      { name: 'codex', model_name: 'openai/zai/glm-5.3', env: merge },
      { name: 'pi', model_name: 'openai/gpt-6.1-sol', env: merge },
      { name: 'pi', model_name: 'custom/zai/glm-5.3', env: merge },
    ]) {
      expect(readTrial(fixture(agent).dir, null)?.model).toBe(agent.model_name)
    }
    expect(readTrial(fixture({ name: 'pi', model_name: 'openai/openai/gpt-6.1-sol', env: merge }).dir, null)).toMatchObject({ model: 'openai/gpt-6.1-sol', provider: 'openai', modelShort: 'gpt-6.1-sol' })
  })
  test('fails visibly for incomplete or malformed trials', () => {
    const { root, dir } = fixture()
    writeFileSync(join(dir, 'result.json'), '{bad')
    expect(() => exportJob(root, null)).toThrow()
    rmSync(join(dir, 'result.json'))
    writeFileSync(join(dir, 'config.json'), '{}')
    expect(exportJob(root, null).rows).toHaveLength(0)
    expect(() => exportJob(root, null, { requireComplete: true })).toThrow('Incomplete trial')
  })
  test('combines distinct runs, retains settings and metadata, rejects double counting', () => {
    const a = exportJob(fixture().root, null)
    const b = exportJob(fixture({ name: 'custom', kwargs: { thinking: 'disabled' } }).root, null)
    b.rows[0].trialId = 'another-trial-id'
    b.rows[0].taskChecksum = 'different-checksum'
    const merged = mergeJobs([a, b], 'combined')
    expect(merged.rows).toHaveLength(2)
    expect(merged.rows.map(r => r.thinking)).toEqual(['enabled', 'disabled'])
    expect(merged.rows.map(r => r.taskChecksum)).toEqual(['checksum', 'different-checksum'])
    expect(merged.sources?.map(s => s.source)).toEqual([a.source, b.source])
    expect(() => mergeJobs([a, a], 'duplicate')).toThrow('Duplicate trial')
    const copied = { ...a, rows: a.rows.map(row => ({ ...row, source: '/copied/job' })) }
    expect(() => mergeJobs([a, copied], 'duplicate')).toThrow('Duplicate trial')
    expect(() => mergeJobs([merged, a], 'duplicate')).toThrow('Duplicate trial')
  })
  test('connected partial exports retain verifier passes and failures but skip unfinished artifacts', () => {
    const { root, dir } = fixture()
    const finished = { finished_at: '2026-10-03T00:00:00Z', verifier_result: { rewards: { reward: 0 } } }
    writeFileSync(join(dir, 'result.json'), JSON.stringify(finished))
    expect(exportJob(root, null, { verifiedOnly: true }).rows).toMatchObject([{ reward: 0, passed: 0 }])
    writeFileSync(join(dir, 'result.json'), JSON.stringify({ ...finished, verifier_result: { rewards: { reward: 1 } } }))
    expect(exportJob(root, null, { verifiedOnly: true }).rows).toMatchObject([{ reward: 1, passed: 1 }])
    for (const result of [null, {}, { ...finished, finished_at: 'invalid' }, { ...finished, verifier_result: null }, { ...finished, exception_info: { exception_type: 'CancelledError' } }]) {
      writeFileSync(join(dir, 'result.json'), JSON.stringify(result))
      expect(exportJob(root, null, { verifiedOnly: true }).rows).toHaveLength(0)
    }
    for (const result of ['{bad', '{"finished_at":"2026-10-03T00:00:00Z","verifier_result":{"reward":1e999}}']) {
      writeFileSync(join(dir, 'result.json'), result)
      expect(exportJob(root, null, { verifiedOnly: true }).rows).toHaveLength(0)
    }
  })
  test('a partially written job summary cannot discard verified trial results', () => {
    const { root, dir } = fixture()
    writeFileSync(join(dir, 'result.json'), JSON.stringify({ finished_at: '2026-10-03T00:00:00Z', verifier_result: { reward: 1 } }))
    writeFileSync(join(root, 'result.json'), '{unfinished')
    expect(exportJob(root, null, { verifiedOnly: true })).toMatchObject({ jobId: null, rows: [{ passed: 1 }] })
    expect(() => exportJob(root, null)).toThrow()
  })
})
