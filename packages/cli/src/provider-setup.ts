import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { connectMerge, mergeStatus } from './merge'
import { setupMergeProfiles } from './runner/profiles'
import { renderProviderPage, providerScript, DEFAULT_APP_URL } from './provider-page'
import harnessCatalog from '../../../src/harness-catalog.json'
import { dirname, join } from 'node:path'
import { readFileSync } from 'node:fs'

/** Loopback-only UI; expires when no authenticated page keeps it alive. */
export type SetupActions = {
  status: () => Promise<unknown>
  connect: (key: string) => Promise<unknown>
  profiles: (model: string, harnesses: string[]) => Promise<unknown>
  pair: (url: string, code: string) => Promise<unknown>
}
export async function startProviderSetup(directory: string, bundledTask: string, port = 0, connect = connectMerge, actions?: SetupActions, selectedHarnesses = ['codex'], idleTimeoutMs = 15 * 60_000) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Use a port between 0 and 65535.')
  const app = new URL(process.env.HEVAL_APP_URL || DEFAULT_APP_URL)
  if (app.protocol !== 'https:' && !(app.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(app.hostname))) throw new Error('HEVAL_APP_URL must be HTTPS or a local development origin.')
  const token = randomBytes(32).toString('hex')
  let busy = false
  const server = createServer(async (req, res) => {
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'")
    const json = (status: number, body: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }
    const navigation = req.method === 'GET' && req.url === '/' && req.headers['sec-fetch-mode'] === 'navigate'
    if (req.headers.host !== origin.slice(7) || (req.headers.origin && req.headers.origin !== origin) || (req.headers['sec-fetch-site'] === 'cross-site' && !navigation)) { json(403, { error: 'Use this worker’s local setup URL.' }); return }
    const icon = harnessCatalog.find(h => req.url === `/harnesses/${h.logo}`)
    if (req.method === 'GET' && icon) {
      try { const bytes = readFileSync(join(dirname(bundledTask), 'web/harnesses', icon.logo)); res.writeHead(200, { 'Content-Type': icon.logo.endsWith('.png') ? 'image/png' : 'image/svg+xml' }); res.end(bytes) }
      catch { json(404, { error: 'Icon unavailable.' }) }
      return
    }
    if (req.method === 'GET' && (req.url === '/' || req.url === '/setup.js')) {
      res.writeHead(200, { 'Content-Type': req.url === '/' ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8' })
      res.end(req.url === '/' ? renderProviderPage(selectedHarnesses, app.origin) : providerScript); return
    }
    const supplied = Buffer.from(req.headers.authorization ?? '')
    const expected = Buffer.from(`Bearer ${token}`)
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) { json(403, { error: 'Open the current setup link from your worker terminal.' }); return }
    if (req.method === 'GET' && req.url === '/api/heartbeat') {
      expiry.refresh()
      json(200, { active: true }); return
    }
    if (req.method === 'GET' && req.url === '/api/status') {
      try { json(200, actions ? await actions.status() : mergeStatus(directory)) }
      catch { json(503, { error: 'Worker unavailable. Check Docker and rerun setup.' }) }
      return
    }
    if (req.method !== 'POST' || !['/api/connect', '/api/profiles', ...(actions ? ['/api/pair'] : [])].includes(req.url ?? '')) { json(404, { error: 'Not found.' }); return }
    if (req.headers.origin !== origin || req.headers['content-type'] !== 'application/json') { json(403, { error: 'Submit this form from the local setup page.' }); return }
    if (busy) { json(409, { error: 'Another setup request is running. Try again when it finishes.' }); return }
    busy = true
    try {
      const chunks: Buffer[] = []; let length = 0
      for await (const chunk of req) {
        length += chunk.length
        if (length > 8192) { json(413, { error: 'Setup input is too large.' }); return }
        chunks.push(Buffer.from(chunk))
      }
      let body: Record<string, unknown>
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { json(400, { error: 'Invalid setup input.' }); return }
      if (!body || typeof body !== 'object' || Array.isArray(body)) { json(400, { error: 'Invalid setup input.' }); return }
      if (req.url === '/api/connect') {
        if (typeof body.key !== 'string' || !body.key.trim() || body.key.trim().length > 4096 || /\s/.test(body.key.trim())) { json(400, { error: 'Paste only the key value, without spaces or a Bearer prefix.' }); return }
        try { json(200, actions ? await actions.connect(body.key.trim()) : await connect(directory, body.key.trim())) }
        catch { json(400, { error: 'Merge could not verify that key. Check your model-calling key and connection, then try again. The saved key has not changed.' }) }
      } else if (req.url === '/api/pair') {
        if (typeof body.url !== 'string' || typeof body.code !== 'string' || !/^[a-f0-9]{64}$/.test(body.code)) { json(400, { error: 'Paste the deployment URL and complete pairing code from Heval’s Machines page.' }); return }
        try { json(200, await actions!.pair(body.url, body.code)) }
        catch { json(400, { error: 'Pairing failed. Check the deployment URL and pairing code. If a response was lost, retry the same code. An already paired worker cannot be paired again.' }) }
      } else {
        if (typeof body.model !== 'string' || !Array.isArray(body.harnesses) || body.harnesses.some(h => typeof h !== 'string')) { json(400, { error: 'Choose a model and at least one harness.' }); return }
        try { json(200, actions ? await actions.profiles(body.model, body.harnesses as string[]) : { profiles: setupMergeProfiles(directory, bundledTask, body.model, body.harnesses as string[]) }) }
        catch (error) { json(400, { error: error instanceof Error ? error.message : 'Could not prepare profiles.' }) }
      }
    } catch { if (!res.writableEnded) json(400, { error: 'Setup request could not be read.' }) }
    finally { busy = false }
  })
  server.requestTimeout = 20_000
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve() })
  })
  const expiry = setTimeout(() => { server.closeAllConnections(); server.close() }, idleTimeoutMs)
  expiry.unref()
  server.once('close', () => clearTimeout(expiry))
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/#token=${token}` }
}
