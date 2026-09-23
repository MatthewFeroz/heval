import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { exportJob, readTrial } from './trials'
import { mergeJobs } from './merge-jobs'

const roots: string[] = []
function fixture(agent: object = { import_path: 'smoke_adapters:DeepSeekHarness', kwargs: { thinking: 'enabled', api_key: 'secret' } }) {
  const root = mkdtempSync(join(tmpdir(), 'harbor-export-'))
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
})
