import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fetchCatalog } from '../harbor/gateway/catalog'
import { createRunner } from '../server/runner'
import { dockerBackend } from '../server/docker'
import { exportRuns } from '../server/run-export'
import { createInferenceProxy } from '../server/inference-proxy'

const models = ['nvidia/nemotron-3.5-lightning-30b-a3b', 'nvidia/nemotron-super-3-120b']
const execute = process.argv.includes('--run')
const key = process.env.HEVAL_GATEWAY_API_KEY
if (!key) {
  console.error('Set HEVAL_GATEWAY_API_KEY in .env.local. The key is never printed. Then run bun run demo:nvidia for a live catalog check, or add --run for two model-backed attempts.')
  process.exit(1)
}
const catalog = await fetchCatalog(key).catch(() => {
  throw new Error('Could not read the Merge catalog. Check the configured key and network access.')
})
const pins: Record<string, string> = {}
for (const model of models) {
  const routes = catalog.models.find(entry => entry.model === model)?.vendors.filter(route => route.supportsToolCalling && route.status === 'available') ?? []
  const route = routes.find(value => value.vendor === 'nvidia') ?? routes[0]
  if (!route) throw new Error(`No available tool-calling route for ${model}. Choose a model from the current catalog before running.`)
  pins[model] = route.vendor
  console.log(`${model}: ${route.vendor}, tool calling available`)
}
if (!execute) {
  console.log('Catalog check passed. No model calls made. Add --run to evaluate both models sequentially on concurrent-cache-v1, with a five-minute limit each.')
  process.exit(0)
}
if (process.env.HEVAL_PROVIDER === 'nvidia') throw new Error('This profile uses Merge Gateway. Unset HEVAL_PROVIDER=nvidia first.')
if (process.env.DOCKER_HOST?.startsWith('ssh://') && !process.env.HEVAL_DEMO_PROXY_HOST) throw new Error('Set HEVAL_DEMO_PROXY_HOST to this computer’s worker-reachable IP or hostname before using a remote Docker worker.')
const docker = Bun.spawn(['docker', 'image', 'inspect', process.env.HEVAL_WORKER_IMAGE || 'heval-worker:local'], { stdout: 'ignore', stderr: 'ignore' })
if (await docker.exited !== 0) throw new Error('Start Docker and run bun run worker:build before evaluating.')
const directory = resolve(process.env.HEVAL_DATA_DIR || 'data', 'nvidia-demo', new Date().toISOString().replaceAll(':', '-'))
await mkdir(directory, { recursive: true })
// Pi can send an explicit vendor in its sampling parameters. Preserve the
// requested route in the protocol; do not claim an observed serving vendor.
process.env.HEVAL_VENDOR_PINS_JSON = JSON.stringify(pins)
const runner = createRunner({ backend: dockerBackend(process.env.HEVAL_WORKER_IMAGE || 'heval-worker:local'), directory,
  maxConcurrent: 1, maxPerUser: 1, maxDailyPerUser: 2, timeoutMs: 300000, gradeTimeoutMs: 30000,
  maxOutputBytes: 8 * 1024 * 1024, model: models[0], allowedModels: models, secret: key })
await runner.ready
const proxyServer = Bun.serve({ hostname: '0.0.0.0', port: 0, idleTimeout: 255, maxRequestBodySize: 8 * 1024 * 1024, fetch: req => proxy.handle(req) })
const proxy: ReturnType<typeof createInferenceProxy> = createInferenceProxy({ secret: () => key }, `http://${process.env.HEVAL_DEMO_PROXY_HOST || 'host.docker.internal'}:${proxyServer.port}/api/inference`)
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void runner.shutdown().then(() => process.exit(130)) })
await writeFile(join(directory, 'protocol.json'), JSON.stringify({ date: new Date().toISOString(), task: 'concurrent-cache-v1',
  models, requestedVendors: pins, harness: 'pi-agent', attemptsPerModel: 1, timeLimitSeconds: 300,
  catalogFetchedAt: catalog.fetchedAt, maxInferenceRequests: 40, maxOutputTokensPerRequest: 8192, limitations: ['One task and one attempt per model. No general ranking.', 'Usage and cost are unavailable unless measured.', 'Requested vendor is not independently verified from response headers.'] }, null, 2))
try {
  for (const model of models) {
    console.log(`Running ${model}…`)
    const access = proxy.issue('local-personal-demo', model, 300000, pins[model])
    let run
    try { run = runner.startRun('pi-agent', 'local-personal-demo', { model }, access) } catch (error) { access.release(); throw error }
    await runner.wait(run.id)
    console.log(`${model}: ${run.status}; tests ${run.grade ? run.grade.passed ? 'passed' : 'failed' : 'not graded'}`)
  }
  const runs = [...runner.runs.values()]
  if (runs.some(run => !run.grade && run.status !== 'timed-out')) throw new Error(`An attempt did not reach grading. Inspect the saved recordings in ${directory}; no comparison was exported.`)
  const output = exportRuns(runs)
  output.job = 'nemotron-personal-' + Date.now()
  const path = join(directory, `${output.job}.json`)
  await writeFile(path, JSON.stringify(output, null, 2))
  console.log(`Saved ${path}. Open this file in Studio. Nothing has been published. To include it in the public build, run bun run publish:result '${path}'.`)
} finally { await runner.shutdown(); proxyServer.stop(true) }
