import { test, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectMonitoring } from './monitoring'
import { monitoringCounts, validateMonitoring } from '../../../../src/runners/monitoring'

test('live artifacts survive partial writes and reconnect without exposing configs or transcripts', () => {
  const root = mkdtempSync(join(tmpdir(), 'heval-monitor-'))
  const trial = join(root, 'jobs/evaluation/task__one')
  try {
    mkdirSync(join(trial, 'agent'), { recursive: true })
    writeFileSync(join(trial, 'config.json'), JSON.stringify({ agent: { env: { API_KEY: 'must-stay-local' } } }))
    writeFileSync(join(trial, 'agent/session.json'), 'private reasoning and must-stay-local')
    writeFileSync(join(trial, 'trial.log'), 'Authorization: Bearer must-stay-local')
    const first = collectMonitoring(root)
    expect(first.trials[0].state).toBe('running')
    writeFileSync(join(trial, 'result.json'), '{"finished_at":')
    const partial = collectMonitoring(root)
    expect(partial.events).toEqual(first.events)
    writeFileSync(join(trial, 'result.json'), JSON.stringify({ finished_at: new Date().toISOString(), verifier_result: { rewards: { reward: 1 } }, exception_info: null }))
    const final = collectMonitoring(root)
    expect(final.trials[0].state).toBe('passed')
    expect(final.events.map(e => e.state)).toEqual(['running', 'passed'])
    expect(collectMonitoring(root).events).toEqual(final.events)
    expect(JSON.stringify(final)).not.toContain('must-stay-local')
    expect(JSON.stringify(final)).not.toContain('reasoning')
    expect(monitoringCounts(final.trials, 100)).toMatchObject({ passed: 1, finished: 1, pending: 99, errors: 0 })
    expect(() => validateMonitoring(final, 100)).not.toThrow()
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('missing rewards and execution errors remain separate from failed verification', () => {
  const root = mkdtempSync(join(tmpdir(), 'heval-monitor-'))
  try {
    for (const [id, result] of Object.entries({
      failed: { verifier_result: { rewards: { reward: 0 } } },
      error: { exception_info: { exception_type: 'RuntimeError', exception_message: 'secret' } },
      missing: {},
    })) {
      const dir = join(root, 'jobs/evaluation', id); mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'config.json'), '{}')
      writeFileSync(join(dir, 'result.json'), JSON.stringify({ finished_at: new Date().toISOString(), ...result }))
    }
    const value = collectMonitoring(root)
    expect(monitoringCounts(value.trials, 3)).toMatchObject({ failed: 1, errors: 2, passed: 0, finished: 3 })
    expect(JSON.stringify(value)).not.toContain('secret')
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('ignores symlinked trial directories and bounds the replay window', () => {
  const root = mkdtempSync(join(tmpdir(), 'heval-monitor-'))
  try {
    const job = join(root, 'jobs/evaluation'); mkdirSync(job, { recursive: true })
    const external = join(root, 'external'); mkdirSync(external); writeFileSync(join(external, 'config.json'), '{}')
    symlinkSync(external, join(job, 'linked'), 'junction')
    for (let i = 0; i < 205; i++) { const dir = join(job, `task-${i}`); mkdirSync(dir); writeFileSync(join(dir, 'config.json'), '{}') }
    const value = collectMonitoring(root)
    expect(value.trials).toHaveLength(205)
    expect(value.events).toHaveLength(200)
    expect(value.events[0].sequence).toBe(6)
    expect(() => validateMonitoring(value, 205)).not.toThrow()
    expect(() => validateMonitoring(value, 204)).toThrow('bounds')
  } finally { rmSync(root, { recursive: true, force: true }) }
})


test('a retried execution error updates to running and success in the same Harbor trial directory', () => {
 const root=mkdtempSync(join(tmpdir(),'heval-monitor-retry-'))
 try {
  const dir=join(root,'jobs/evaluation/retried'); mkdirSync(dir,{recursive:true})
  writeFileSync(join(dir,'config.json'),'{}')
  writeFileSync(join(dir,'result.json'),JSON.stringify({finished_at:new Date().toISOString(),exception_info:{exception_type:'RuntimeError'}}))
  expect(collectMonitoring(root).trials[0].state).toBe('error')
  rmSync(join(dir,'result.json'))
  expect(collectMonitoring(root).trials[0].state).toBe('running')
  writeFileSync(join(dir,'result.json'),JSON.stringify({finished_at:new Date().toISOString(),verifier_result:{rewards:{reward:1}}}))
  const final=collectMonitoring(root)
  expect(final.trials[0].state).toBe('passed')
  expect(final.events.map(e=>e.state)).toEqual(['error','running','passed'])
  expect(()=>validateMonitoring(final,1)).not.toThrow()
 } finally {rmSync(root,{recursive:true,force:true})}
})
