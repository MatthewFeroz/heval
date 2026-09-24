import assert from 'node:assert/strict'
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { SOCIAL_DEFAULTS, SOCIAL_PRESETS } from '../src/charts/social-presets'
import fixture from '../results/harbor/demo-evaluation.json'
const root = await mkdtemp(join(tmpdir(), 'heval-renderer-smoke-'))
try {
  const build = await Bun.build({ entrypoints: ['server/hosted-exports/renderer.ts'], target: 'node', format: 'esm' })
  assert.ok(build.success, build.logs.join('\n'))
  await writeFile(join(root, 'renderer.mjs'), Buffer.from(await build.outputs[0].arrayBuffer()))
  await cp('harbor/report/assets', join(root, 'harbor/report/assets'), { recursive: true })
  for (const file of ['render-poster.mjs', 'layout-check.js']) await cp(`harbor/report/${file}`, join(root, 'harbor/report', file))
  await symlink(resolve('node_modules'), join(root, 'node_modules'))
  for (const theme of ['plain-light', 'plain-dark'] as const) for (const collection of [false, true]) {
    await writeFile(join(root, 'input.json'), JSON.stringify({ input: fixture, settings: { ...SOCIAL_DEFAULTS, theme, collection: Object.keys(SOCIAL_PRESETS) }, collection }))
    const child = Bun.spawn(['node', join(root, 'renderer.mjs')], { env: { ...process.env, HEVAL_RENDER_ROOT: root }, stdout: 'pipe', stderr: 'pipe' })
    const error = await new Response(child.stderr).text()
    assert.equal(await child.exited, 0, error)
    const meta = JSON.parse(await readFile(join(root, 'output.json'), 'utf8')), bytes = await readFile(join(root, 'output.bin'))
    assert.equal(meta.size, bytes.length)
    if (!collection) {
      assert.equal(meta.type, 'image/png'); assert.equal(bytes.readUInt32BE(16), 3200); assert.equal(bytes.readUInt32BE(20), 1800)
      await writeFile(`/tmp/heval-hosted-renderer-${theme}.png`, bytes)
    } else {
      assert.equal(meta.type, 'application/zip'); assert.equal(bytes.readUInt32LE(0), 0x04034b50)
      assert.ok(bytes.includes(Buffer.from('manifest.json'))); assert.ok(bytes.includes(Buffer.from('values.csv')))
    }
  }
  console.log('PASS: bundled Node renderer produces PNGs and every question in ZIPs for white and black themes.')
} finally { await rm(root, { recursive: true, force: true }) }
