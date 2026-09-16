import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { packageForModule } from '../scripts/package-license'

const roots: string[] = []
afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

test('resolves the owning package past metadata-only nested manifests', () => {
  const root = mkdtempSync(join(tmpdir(), 'heval-package-license-'))
  roots.push(root)
  const packageRoot = join(root, 'node_modules', 'convex')
  const moduleRoot = join(packageRoot, 'dist', 'esm')
  mkdirSync(moduleRoot, { recursive: true })
  writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ name: 'convex', version: '1.45.0', license: 'Apache-2.0' }))
  writeFileSync(join(moduleRoot, 'package.json'), JSON.stringify({ type: 'module' }))

  expect(packageForModule(`${moduleRoot}/values/index.js?commonjs-entry`)).toEqual({
    folder: packageRoot,
    manifest: { name: 'convex', version: '1.45.0', license: 'Apache-2.0' },
  })
})

test('ignores modules that are not third-party dependencies', () => {
  expect(packageForModule('/workspace/src/studio/main.tsx')).toBeNull()
})
