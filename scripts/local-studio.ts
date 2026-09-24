import { createServer } from 'vite'
import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')
const port = Number(process.env.HEVAL_STUDIO_PORT || 5181)
const apiPort = Number(process.env.HEVAL_STUDIO_API_PORT || 4173)
const backend = Bun.spawn(['bun', 'server/index.ts'], {
  cwd: root,
  env: {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: String(apiPort),
    HEVAL_HOSTED: '0',
    HEVAL_ENABLE_RUNNER: '0',
    HEVAL_ENABLE_EXPORTS: '1',
  },
  stdout: 'inherit',
  stderr: 'inherit',
})
const frontend = await createServer({
  root,
  define: { 'import.meta.env.VITE_HEVAL_STATIC_SITE': JSON.stringify('0') },
  server: {
    host: '127.0.0.1',
    port,
    strictPort: true,
    proxy: { '/api': { target: `http://127.0.0.1:${apiPort}`, ws: true } },
  },
})
let closing = false
async function close(code = 0) {
  if (closing) return
  closing = true
  backend.kill()
  await frontend.close()
  process.exit(code)
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => void close())
void backend.exited.then(code => {
  if (!closing) {
    console.error('The local export server stopped.')
    void close(code || 1)
  }
})
try {
  await frontend.listen()
  console.log(`Local Studio: http://localhost:${port}/local-studio.html?job=demo-evaluation&mode=presentation`)
} catch (error) {
  console.error(error)
  await close(1)
}
