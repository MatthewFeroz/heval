import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { request } from 'node:http'
import type { Server } from 'node:http'
import { doctor } from './doctor'
import { loadInput, validateExport } from './input'
import { startViewer } from './viewer'

const temporary: string[] = []
const servers: Server[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    await new Promise<void>(done => server.close(() => done()))
  }
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true })
})
function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'heval-cli-test-'))
  temporary.push(dir)
  return dir
}
const examplePath = resolve(import.meta.dirname, '../../../results/harbor/terminal-bench-comparison.json')

test('doctor separates viewing from execution and never outputs credential values', async () => {
  const checks = await doctor(async command => command === 'harbor' ? 'harbor 0.23.0' : null, { OPENAI_API_KEY: 'private-test-value' })
  expect(checks.find(check => check.name === 'Harbor')?.ok).toBe(true)
  expect(checks.find(check => check.name === 'Docker engine')?.ok).toBe(false)
  expect(checks.find(check => check.name === 'Provider credentials')?.ok).toBe(true)
  expect(JSON.stringify(checks)).not.toContain('private-test-value')
  expect(checks.find(check => check.name === 'Bun')?.required).toBe(false)
})

test('doctor rejects the previous pin and development builds', async () => {
  for (const version of ['0.22.0', '0.23.0.dev20260917', '0.23.1']) {
    const checks = await doctor(async command => command === 'harbor' ? `harbor ${version}` : null, {})
    expect(checks.find(check => check.name === 'Harbor')?.ok).toBe(false)
  }
})

test('imports a normalized export without changing recorded values', () => {
  const input = loadInput(examplePath)
  const original = JSON.parse(readFileSync(examplePath, 'utf8'))
  expect(input.rows).toEqual(original.rows)
  expect(input.rows.length).toBe(120)
})

test('raw Harbor imports retain reported cost and do not guess missing prices', () => {
  const dir = scratch()
  mkdirSync(join(dir, 'trial one'))
  mkdirSync(join(dir, 'trial two'))
  for (const trial of ['trial one', 'trial two']) {
    writeFileSync(join(dir, trial, 'config.json'), JSON.stringify({ agent: { name: 'codex', model_name: 'test/model', env: { OPENAI_API_KEY: 'private-test-value' } } }))
    writeFileSync(join(dir, trial, 'result.json'), JSON.stringify({ task_name: 'test/task', verifier_result: { rewards: { reward: 1 } }, agent_result: trial === 'trial one' ? { cost_usd: 0.02 } : {}, agent_info: { version: '1.0' } }))
  }
  mkdirSync(join(dir, 'unfinished'))
  writeFileSync(join(dir, 'unfinished', 'config.json'), '{}')
  const job = loadInput(dir)
  expect(job.rows).toHaveLength(2)
  expect(job.rows.map(row => row.costUsd)).toEqual([0.02, null])
  expect(job.agentVersions.codex).toEqual(['1.0'])
  expect(JSON.stringify(job)).not.toContain('private-test-value')
})

test('rejects empty jobs, malformed exports, and a bundle passed as a job', () => {
  expect(() => loadInput(scratch())).toThrow('No completed trials')
  expect(() => validateExport({ artifactType: 'heval-bundle' })).toThrow('Open export')
  const job = loadInput(examplePath)
  expect(() => validateExport({ ...job, rows: [{ ...job.rows[0], taskFull: undefined }] })).toThrow('taskFull')
  expect(() => validateExport({ ...job, rows: [{ ...job.rows[0], passed: 7 }] })).toThrow('passed')
  expect(() => validateExport({ ...job, rows: [{ ...job.rows[0], costUsd: 'free' }] })).toThrow('costUsd')
})

test('viewer serves selected results and assets, with no arbitrary filesystem or execution API', async () => {
  const web = scratch()
  writeFileSync(join(web, 'studio.html'), '<html>Viewer</html>')
  writeFileSync(join(web, 'secret.ts'), 'must not be served')
  const job = loadInput(examplePath)
  job.job = '../../somewhere?unsafe'
  const { server, url } = await startViewer(web, job)
  servers.push(server)
  const origin = new URL(url).origin
  expect(url).toContain('x=modelShort&color=none')
  expect(await (await fetch(url)).text()).toContain('Viewer')
  const index = await (await fetch(`${origin}/results/harbor/index.json`)).json()
  expect(index.jobs[0].job).toBe('local')
  expect((await (await fetch(`${origin}/results/harbor/local.json`)).json()).job).toBe(job.job)
  expect((await (await fetch(`${origin}/api/health`)).json()).localViewer).toBe(true)
  expect((await fetch(`${origin}/api/runs`, { method: 'POST' })).status).toBe(405)
  expect((await fetch(`${origin}/secret.ts`)).status).toBe(404)
  expect((await fetch(`${origin}/results/harbor/other.json`)).status).toBe(404)
  expect((await fetch(`${origin}/api/health`, { headers: { Origin: 'https://example.com' } })).status).toBe(403)
  const foreignHost = await new Promise<number | undefined>((done, fail) => {
    const req = request(`${origin}/api/health`, { headers: { Host: 'attacker.example' } }, res => { res.resume(); done(res.statusCode) })
    req.on('error', fail); req.end()
  })
  expect(foreignHost).toBe(403)
  const traversal = await new Promise<number | undefined>((done, fail) => {
    const req = request(`${origin}`, { path: '/%2e%2e%2fpackage.json' }, res => { res.resume(); done(res.statusCode) })
    req.on('error', fail); req.end()
  })
  expect(traversal).toBe(404)
  expect(await (await fetch(url, { method: 'HEAD' })).text()).toBe('')
})
