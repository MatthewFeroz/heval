import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
for (const file of ['dist/cli.js', 'dist/web/studio.html', 'dist/example.json', 'dist/THIRD_PARTY_NOTICES.txt']) {
  if (!existsSync(resolve(root, file))) throw new Error(`Missing ${file}. Run bun run cli:build from the repository root before packing.`)
}
if (!readFileSync(resolve(root, 'dist/cli.js'), 'utf8').startsWith('#!/usr/bin/env node')) {
  throw new Error('The CLI must have a Node.js executable header.')
}
