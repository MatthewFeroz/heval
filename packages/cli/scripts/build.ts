import { chmodSync, cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { packageForModule } from './package-license'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const pkg = join(root, 'packages/cli')
const dist = join(pkg, 'dist')
mkdirSync(join(root, '.scratch'), { recursive: true })
rmSync(dist, { recursive: true, force: true })
mkdirSync(dist, { recursive: true })

// Collect the actual bundled browser dependencies, including their license texts.
const notices = new Map<string, string>()
const licenses: Plugin = {
  name: 'heval-package-notices',
  generateBundle(_options, bundle) {
    for (const chunk of Object.values(bundle)) {
      if (chunk.type !== 'chunk') continue
      for (const id of Object.keys(chunk.modules)) {
        if (!id.includes('/node_modules/')) continue
        const dependency = packageForModule(id)
        if (!dependency) throw new Error(`Could not resolve bundled dependency package: ${id}`)
        const { folder, manifest: info } = dependency
        const key = `${info.name}@${info.version}`
        if (notices.has(key)) continue
        const texts = readdirSync(folder, { withFileTypes: true })
          .filter(entry => entry.isFile() && /^(licen[sc]e|copying|notice)(\.|$|-)/i.test(entry.name))
          .map(entry => readFileSync(join(folder, entry.name), 'utf8'))
        if (!texts.length) throw new Error(`Missing bundled dependency license text: ${key}`)
        notices.set(key, `${key}\nLicense: ${info.license ?? 'See below'}\n\n${texts.join('\n\n')}`)
      }
    }
  },
}

await build({
  configFile: false,
  root: join(pkg, 'web'),
  publicDir: join(root, 'public'),
  plugins: [react(), licenses, {
    name: 'heval-offline-fonts',
    enforce: 'pre',
    transform(code, id) {
      if (id.replaceAll('\\', '/') !== join(root, 'src/studio/studio.css').replaceAll('\\', '/')) return
      // The npm viewer excludes the licensed presentation fonts. Remove their
      // declarations before Vite resolves and copies the referenced assets.
      return code.replace(/@font-face\s*\{[^}]*FH Oscar Pro[^}]*\}/g, '')
    },
    generateBundle(_options, bundle) {
      // Vite resolves CSS @imports internally, so remove the remote font import
      // from the final CSS. The existing font stacks include system fallbacks.
      for (const asset of Object.values(bundle)) {
        if (asset.type === 'asset' && asset.fileName.endsWith('.css')) {
          const css = typeof asset.source === 'string' ? asset.source : new TextDecoder().decode(asset.source)
          asset.source = css.replace(/@import\s+(?:url\()?(['"])https:\/\/fonts\.googleapis\.com[^'"]+\1\)?\s*;/g, '')
        }
      }
    },
  }],
  build: {
    outDir: join(dist, 'web'),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1100,
    rollupOptions: { input: join(pkg, 'web/studio.html') },
  },
})
const result = await Bun.build({
  entrypoints: [join(pkg, 'src/cli.ts'), join(pkg, 'src/runner-supervisor.ts'), join(pkg, 'src/setup-worker.ts')],
  outdir: dist,
  target: 'node',
  format: 'esm',
  define: { 'import.meta.main': 'false' },
  minify: { syntax: true, whitespace: false, identifiers: false },
})
if (!result.success) throw new AggregateError(result.logs, 'CLI build failed')
chmodSync(join(dist, 'cli.js'), 0o755)
cpSync(join(pkg, 'runner-task'), join(dist, 'runner-task'), { recursive: true })
cpSync(join(pkg, 'worker'), join(dist, 'worker'), { recursive: true, filter: path => !path.split(/[/\\]/).includes('__pycache__') && !path.endsWith('.pyc') })
const example = JSON.parse(readFileSync(join(root, 'results/harbor/demo-evaluation.json'), 'utf8'))
example.source = 'Synthetic demonstration data; not evaluation evidence'
writeFileSync(join(dist, 'example.json'), JSON.stringify(example) + '\n')
writeFileSync(join(dist, 'THIRD_PARTY_NOTICES.txt'), [...notices].sort(([a], [b]) => a.localeCompare(b)).map(([, text]) => text).join('\n\n----------------------------------------\n\n') + '\n')
console.log('Built Node CLI and local Studio in packages/cli/dist (no runtime npm dependencies).')
