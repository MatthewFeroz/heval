import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Never load a browser-supplied module or inherit an arbitrary PYTHONPATH. */
export function bundledAdapters() {
  const here = dirname(fileURLToPath(import.meta.url))
  const packaged = join(here, 'worker')
  return existsSync(join(packaged, 'heval_agents.py')) ? packaged : resolve(here, '../../worker')
}
