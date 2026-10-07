import { afterEach, expect, test } from 'bun:test'
import { createServer, type Server } from 'node:http'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const cleanups: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup() })

async function proxy(options: { pins?: boolean; budget?: number; rates?: object } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'heval-proxy-'))
  const spend = join(directory, 'spend')
  mkdirSync(spend)
  const log = join(spend, 'proxy.jsonl')
  const requests: Record<string, unknown>[] = []
  let finishStream: (() => void) | undefined
  const upstream: Server = createServer(async (req, res) => {
    let raw = ''
    for await (const chunk of req) raw += chunk
    const body = JSON.parse(raw)
    requests.push(body)
    res.setHeader('x-merge-vendor', 'particle')
    if (body.mode === 'paused' || body.mode === 'json-paused') {
      res.setHeader('content-type', body.mode === 'paused' ? 'text/event-stream' : 'application/json')
      res.write(body.mode === 'paused' ? 'data: {"choices":[]}\n\n' : '{"usage":{"prompt_tokens":100,"completion_tokens":50}}')
      finishStream = () => res.end(body.mode === 'paused' ? 'data: {"usage":{"prompt_tokens":100,"completion_tokens":50}}\n\n' : '')
    } else if (body.mode === 'reset') {
      res.setHeader('content-type', 'text/event-stream')
      res.write('data: {"usage":{"prompt_tokens":100,"completion_tokens":50}}\n\n')
      setTimeout(() => res.destroy(), 50)
    } else if (body.mode === 'json-reset') {
      res.setHeader('content-type', 'application/json')
      res.write('{"usage":{"prompt_tokens":100,"completion_tokens":50}}')
      setTimeout(() => res.destroy(), 50)
    } else if (body.mode === 'anthropic') {
      res.setHeader('content-type', 'text/event-stream')
      res.end('data: {"message":{"usage":{"input_tokens":10,"cache_read_input_tokens":20,"cache_creation_input_tokens":30}}}\n\ndata: {"usage":{"output_tokens":40}}\n\n')
    } else if (body.mode === 'sse') {
      res.setHeader('content-type', 'text/event-stream')
      res.write('data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: {"us')
      res.end('age":{"prompt_tokens":1000000,"completion_tokens":0}}\n\ndata: [DONE]\n\n')
    } else {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ usage: { prompt_tokens: 1000000, completion_tokens: 0 } }, null, body.mode === 'pretty' ? 2 : undefined))
    }
  })
  await new Promise<void>(done => upstream.listen(0, '127.0.0.1', done))
  const upstreamPort = (upstream.address() as { port: number }).port
  writeFileSync(join(directory, 'rates.json'), JSON.stringify(options.rates ?? { 'test/model': { input: 1, cacheRead: 0.1, output: 2 } }))
  writeFileSync(join(directory, 'pins.json'), JSON.stringify({ 'test/model': 'particle' }))
  const args = [Bun.argv[0], join(import.meta.dirname, 'vendor-proxy.ts'), '--port', '0', '--upstream', `http://127.0.0.1:${upstreamPort}`, '--log', log,
    ...(options.pins ? ['--pins', join(directory, 'pins.json')] : ['--vendor', 'particle']),
    '--rates', join(directory, 'rates.json'), '--only-model', 'test/model', '--reject-hosted-tools', '--thinking-as-effort',
    ...(options.budget === undefined ? [] : ['--budget-usd', String(options.budget)]),
  ]
  const child = Bun.spawn(args, { env: { PATH: process.env.PATH }, stdout: 'pipe', stderr: 'pipe' })
  cleanups.push(async () => {
    finishStream?.()
    if (child.exitCode === null) child.kill('SIGTERM')
    await child.exited
    upstream.closeAllConnections()
    await new Promise<void>(done => upstream.close(() => done()))
    rmSync(directory, { recursive: true, force: true })
  })
  const reader = child.stdout.getReader()
  let output = ''
  const port = await Promise.race([
    (async () => {
      while (true) {
        const next = await reader.read()
        if (next.done) throw new Error(`Proxy exited: ${output} ${await new Response(child.stderr).text()}`)
        output += new TextDecoder().decode(next.value)
        const match = output.match(/listening\s+http:\/\/localhost:(\d+)/)
        if (match) return Number(match[1])
      }
    })(),
    new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(new Error('Proxy did not start')), 5000); timer.unref() }),
  ])
  // Keep the output pipe drained while the child runs.
  void (async () => { while (!(await reader.read()).done) { /* drain */ } })()
  const send = (body: object, path = '/v1/openai/chat/completions', signal?: AbortSignal) => fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'test/model', ...body }), signal })
  const entries = () => existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) : []
  return { send, entries, requests, spend, log, child, finishStream: () => finishStream?.() }
}

test('streams unchanged, prices usage and shares the completed-spend limit', async () => {
  const p = await proxy({ budget: 2 })
  writeFileSync(join(p.spend, 'another-proxy.jsonl'), '{"estCostUsd":1}\n')
  const response = await p.send({ mode: 'sse', thinking: { type: 'enabled' }, reasoning_effort: 'high' })
  expect(await response.text()).toContain('data: [DONE]')
  expect(p.requests[0]).toMatchObject({ vendor: 'particle', reasoning_effort: 'high' })
  expect(p.requests[0].thinking).toBeUndefined()
  expect(p.entries()[0]).toMatchObject({ estCostUsd: 1, rewrote: 'thinking->reasoning_effort' })
  expect((await p.send({})).status).toBe(402)
  expect(p.requests).toHaveLength(1)
})

test('captures Anthropic cache reads, cache writes and cumulative output', async () => {
  const p = await proxy()
  await (await p.send({ mode: 'anthropic' })).text()
  expect(p.entries()[0].usage).toMatchObject({ inputTokens: 60, cachedTokens: 20, outputTokens: 40 })
})

test('an upstream stream reset retains usage and the proxy serves the next request', async () => {
  const p = await proxy()
  await expect((await p.send({ mode: 'reset' })).text()).rejects.toThrow()
  expect(p.entries()[0]).toMatchObject({ usage: { inputTokens: 100, outputTokens: 50 }, usageError: expect.any(String) })
  expect((await p.send({})).status).toBe(200)
})

test('complete JSON usage received before a reset is retained', async () => {
  const p = await proxy()
  await expect((await p.send({ mode: 'json-reset' })).text()).rejects.toThrow()
  expect(p.entries()[0].usage).toMatchObject({ inputTokens: 100, outputTokens: 50 })
})

test('pretty-printed JSON is forwarded unchanged and priced', async () => {
  const p = await proxy()
  const text = await (await p.send({ mode: 'pretty' })).text()
  expect(text).toContain('\n')
  expect(p.entries()[0].estCostUsd).toBe(1)
})

test('only-model uses the vendor resolved from the pins file', async () => {
  const p = await proxy({ pins: true })
  const response = await p.send({})
  expect(response.status).toBe(200)
  await response.text()
  expect(p.requests[0].vendor).toBe('particle')
  expect((await p.send({ vendor: 'other' })).status).toBe(403)
})

test('spend-log read errors refuse requests instead of forwarding without the pin', async () => {
  const p = await proxy({ budget: 2 })
  mkdirSync(join(p.spend, 'unreadable.jsonl'))
  expect((await p.send({})).status).toBe(503)
  expect(p.requests).toHaveLength(0)
})

test('hosted tools and other models never reach the upstream', async () => {
  const p = await proxy()
  expect((await p.send({ tools: [{ type: 'web_search' }] })).status).toBe(400)
  expect((await p.send({ model: 'test/other' })).status).toBe(403)
  expect(p.requests).toHaveLength(0)
})

test('budgeted calls require a configured price', async () => {
  const p = await proxy({ budget: 2, rates: { 'test/other': { input: 1, cacheRead: 0, output: 2 } } })
  expect((await p.send({})).status).toBe(400)
  expect(p.requests).toHaveLength(0)
})

test('restricted proxies refuse media inference endpoints', async () => {
  const p = await proxy({ budget: 0 })
  for (const path of ['/v1/images/generations', '/v1/audio/speech']) expect((await p.send({ model: 'another/model' }, path)).status).toBe(403)
  expect(p.requests).toHaveLength(0)
})

test('corrupt completed spending records cannot disable the budget', async () => {
  const p = await proxy({ budget: 2 })
  writeFileSync(join(p.spend, 'other.jsonl'), '{"estCostUsd":"not-a-number"}\n')
  expect((await p.send({})).status).toBe(503)
  expect(p.requests).toHaveLength(0)
})

test('invalid rate cards fail before the proxy accepts requests', async () => {
  await expect(proxy({ budget: 2, rates: { 'test/model': { input: -1, cacheRead: 0, output: 1 } } })).rejects.toThrow('Invalid rates')
})

test('the client receives data while the upstream response remains open', async () => {
  const p = await proxy()
  const response = await p.send({ mode: 'paused' })
  const reader = response.body!.getReader()
  expect(new TextDecoder().decode((await reader.read()).value)).toBe('data: {"choices":[]}\n\n')
  p.finishStream()
  while (!(await reader.read()).done) { /* drain */ }
  expect(p.entries()[0].usage.inputTokens).toBe(100)
})

test('a log write failure preserves the response and refuses later budgeted calls', async () => {
  const p = await proxy({ budget: 2 })
  const response = await p.send({ mode: 'paused' })
  rmSync(p.log)
  mkdirSync(p.log)
  p.finishStream()
  expect(await response.text()).toContain('prompt_tokens')
  expect((await p.send({})).status).toBe(503)
  expect(p.requests).toHaveLength(1)
})

test('cancelling after complete JSON bytes retains their usage', async () => {
  const p = await proxy()
  const abort = new AbortController()
  const response = await p.send({ mode: 'json-paused' }, undefined, abort.signal)
  expect(new TextDecoder().decode((await response.body!.getReader().read()).value)).toContain('prompt_tokens')
  abort.abort()
  const deadline = Date.now() + 2000
  while (!p.entries().length && Date.now() < deadline) await Bun.sleep(10)
  expect(p.entries()[0]).toMatchObject({ usage: { inputTokens: 100, outputTokens: 50 }, usageError: expect.any(String) })
})
