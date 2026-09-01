import { cpSync, existsSync } from 'node:fs'
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
        next()
      })
    },
    closeBundle() {
      const from = resolve(root, 'results')
      if (existsSync(from)) cpSync(from, resolve(root, 'dist/results'), { recursive: true })
    },
  }
}

export default defineConfig({
  plugins: [react(), hevalResults()],
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
      },
    },
  },
})
