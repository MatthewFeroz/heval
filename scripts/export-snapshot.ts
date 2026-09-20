import { Sandbox } from '@vercel/sandbox'
import { readFile } from 'node:fs/promises'
import { sandboxCredentials } from '../server/hosted-exports/render'
import { motionInput } from '../src/project/motion-input'
import { SOCIAL_DEFAULTS } from '../src/charts/social-presets'
import { parseReport } from '../src/reports/format'
import fixture from '../results/harbor/terminal-bench-comparison.json'

// Run once per renderer/assets change. Dependencies install in the cloud, not on this VM.
const built = await Bun.build({ entrypoints: ['server/hosted-exports/renderer.ts'], target: 'node', format: 'esm' })
if (!built.success) throw new Error(built.logs.join('\n'))
const root = '/vercel/sandbox/heval'
const assets = ['FHOscarPro-Medium.otf', 'FHOscarPro-SemiBold.otf', 'inter.css', 'merge-lockup.svg']
const files = await Promise.all([
  ...assets.map(name => `harbor/report/assets/${name}`), 'harbor/report/render-poster.mjs', 'harbor/report/layout-check.js',
].map(async path => ({ path: `${root}/${path}`, content: await readFile(path) })))
const playwright = JSON.parse(await readFile('node_modules/playwright/package.json', 'utf8')).version as string
const sandbox = await Sandbox.create({ ...sandboxCredentials(), image: 'vercel/sandbox/node:24', persistent: false, timeout: 15 * 60_000, resources: { vcpus: 2 } })
async function run(cmd: string, args: string[], sudo = false) {
  const result = await sandbox.runCommand({ cmd, args, sudo, cwd: root, env: { HEVAL_RENDER_ROOT: root } })
  if (result.exitCode !== 0) throw new Error(`Snapshot setup failed: ${cmd}\n${await result.stderr()}`)
}
try {
  await sandbox.writeFiles([...files, { path: `${root}/renderer.mjs`, content: Buffer.from(await built.outputs[0].arrayBuffer()) },
    { path: `${root}/package.json`, content: Buffer.from(JSON.stringify({ private: true, type: 'module', dependencies: { playwright } })) }])
  console.log('Installing Chromium in Vercel Sandbox…')
  await run('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'])
  await run('node', ['node_modules/playwright/cli.js', 'install-deps', 'chromium'], true)
  await run('node', ['node_modules/playwright/cli.js', 'install', 'chromium'])
  console.log('Checking the actual presentation renderer…')
  await sandbox.writeFiles([{ path: `${root}/input.json`, content: Buffer.from(JSON.stringify({ input: motionInput('Renderer smoke test', parseReport(JSON.stringify(fixture)).rows), settings: SOCIAL_DEFAULTS, collection: false })) }])
  await run('node', [`${root}/renderer.mjs`])
  const metadata = await sandbox.readFileToBuffer({ path: `${root}/output.json` })
  if (!metadata || JSON.parse(metadata.toString()).type !== 'image/png') throw new Error('PNG smoke test failed')
  // Do not retain fixture input or generated artifacts in the reusable snapshot.
  await run('rm', ['input.json', 'output.json', 'output.bin'])
  const snapshot = await sandbox.snapshot({ expiration: 0 })
  console.log(`HEVAL_EXPORT_SNAPSHOT_ID=${snapshot.snapshotId}`)
} finally { await sandbox.stop().catch(() => {}) }
