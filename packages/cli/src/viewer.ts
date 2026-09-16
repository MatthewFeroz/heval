import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import type { AddressInfo } from 'node:net'
import type { JobExport, JobIndex } from '../../../src/charts/trial'

const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' }

export async function startViewer(webRoot: string, job: JobExport, port = 0) {
  // The public route is fixed, never derived from an imported job's name/path.
  const jobKey = 'local'
  const index: JobIndex = { schemaVersion: 1, jobs: [{
    job: jobKey, file: `${jobKey}.json`, generatedAt: job.generatedAt,
    trials: job.rows.length,
    agents: [...new Set(job.rows.map(row => row.agent))],
    models: [...new Set(job.rows.map(row => row.model))],
    tasks: [...new Set(job.rows.map(row => row.task))],
  }] }
  const root = resolve(webRoot)
  const server = createServer(async (req, res) => {
    const address = server.address() as AddressInfo
    const authority = `127.0.0.1:${address.port}`
    const origin = `http://${authority}`
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Cache-Control', 'no-store')
    const sendJson = (status: number, data: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify(data))
    }
    if (req.headers.host !== authority || (req.headers.origin && req.headers.origin !== origin)) {
      sendJson(403, { error: 'This viewer only accepts requests from its local URL.' }); return
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD')
      sendJson(405, { error: 'This is a read-only results viewer. Run evaluations with Harbor in your terminal.' }); return
    }
    let pathname: string
    try { pathname = decodeURIComponent(new URL(req.url ?? '/', origin).pathname) }
    catch { sendJson(400, { error: 'Invalid URL.' }); return }
    if (pathname === '/api/health') {
      sendJson(200, { ok: true, localViewer: true, runnerEnabled: false, exportsEnabled: false }); return
    }
    if (pathname === '/results/harbor/index.json') { sendJson(200, index); return }
    if (pathname === `/results/harbor/${jobKey}.json`) { sendJson(200, job); return }
    if (pathname.startsWith('/api/') || pathname.startsWith('/results/')) {
      sendJson(404, { error: 'Unavailable in the local viewer. Use the chart SVG/PNG buttons or download a bundle.' }); return
    }
    const route = pathname === '/' || pathname === '/studio' ? '/studio.html' : pathname
    const target = resolve(root, `.${route}`)
    if (!target.startsWith(root + sep) || !mime[extname(target)]) { sendJson(404, { error: 'Not found.' }); return }
    try {
      const content = await readFile(target)
      res.writeHead(200, { 'Content-Type': mime[extname(target)] })
      res.end(req.method === 'HEAD' ? undefined : content)
    } catch { sendJson(404, { error: 'Not found.' }) }
  })
  await new Promise<void>((done, fail) => {
    server.once('error', fail)
    server.listen(port, '127.0.0.1', () => { server.off('error', fail); done() })
  })
  const address = server.address() as AddressInfo
  const group = index.jobs[0].agents.length > 1 ? 'stack' : 'modelShort'
  const url = `http://127.0.0.1:${address.port}/studio?job=${jobKey}&x=${group}&color=none`
  return { server, url }
}
