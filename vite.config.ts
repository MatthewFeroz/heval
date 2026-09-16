import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const root = import.meta.dirname

/**
 * The chart studio is a second page, and it reads the normalized job exports
 * that `bun run report` writes to results/harbor/. Those are build output, not
 * source, so they live outside the Vite root's asset graph: serve them from disk
 * in dev and copy them into dist on build.
 */
function hevalResults(): Plugin {
  return {
    name: 'heval-results',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        // /studio is a real page; without this the dev server 404s the pretty URL.
        if (req.url === '/studio' || req.url?.startsWith('/studio?')) {
          req.url = `/studio.html${req.url.slice('/studio'.length)}`
        }
        if (req.url?.match(/^\/(reports|share|machines|evaluations)(\?|$)/)) req.url = `/reports.html${req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`
        next()
      })
    },
    closeBundle() {
      if (process.env.HEVAL_PUBLIC_BUILD === '1') {
        const target = resolve(root, 'dist/results/harbor')
        mkdirSync(target, { recursive: true })
        const from = resolve(root, 'results/public')
        if (existsSync(from)) cpSync(from, target, { recursive: true })
        if (!existsSync(resolve(target, 'index.json'))) writeFileSync(resolve(target, 'index.json'), JSON.stringify({ schemaVersion: 1, jobs: [] }))
        writeFileSync(resolve(root, 'dist/public-build.json'), JSON.stringify({ public: true }))
      } else {
        const from = resolve(root, 'results')
        if (existsSync(from)) cpSync(from, resolve(root, 'dist/results'), { recursive: true })
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), hevalResults()],
  server: { proxy: { '/api': { target: 'http://127.0.0.1:4173', ws: true } } },
  // results/ is served straight from the project root in dev, which Vite allows
  // because it is inside the root; no extra fs.allow entry needed.
  build: {
    // Vega + Vega-Lite are ~900 kB minified and load on one page only; the
    // default 500 kB warning has nothing actionable behind it here.
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
        studio: resolve(root, 'studio.html'),
        reports: resolve(root, 'reports.html'),
      },
    },
  },
})
