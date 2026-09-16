import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseMotionInput } from '../src/project/motion-input'
import type { JobIndex } from '../src/charts/trial'

const path = process.argv[2]
if (!path) throw new Error('Usage: bun run publish:result path/to/personally-owned-result.json. The next public build includes this data.')
const original = JSON.parse(await readFile(resolve(path), 'utf8'))
const input = { ...parseMotionInput(original), generatedAt: typeof original.generatedAt === 'string' ? original.generatedAt : new Date().toISOString() }
if (!/^[a-z0-9][a-z0-9-]{0,180}$/.test(input.job)) throw new Error('Use a lowercase job name with letters, digits and hyphens, at most 181 characters.')
// Publish normalized measurements, without local paths or owner identities.
input.source = 'Heval independent evaluations'
const directory = resolve('results/public')
await mkdir(directory, { recursive: true })
const indexPath = join(directory, 'index.json')
const index: JobIndex = await readFile(indexPath, 'utf8').then(value => JSON.parse(value)).catch((error: NodeJS.ErrnoException) => {
  if (error.code === 'ENOENT') return { schemaVersion: 1, jobs: [] }
  throw error
})
if (index.jobs.some(entry => entry.job === input.job)) throw new Error('A published result already uses this job name. Use a new name to preserve the earlier result.')
await writeFile(join(directory, `${input.job}.json`), JSON.stringify(input, null, 2), { flag: 'wx' })
index.jobs.push({ job: input.job, file: `${input.job}.json`, generatedAt: input.generatedAt, trials: input.rows.length,
  agents: [...new Set(input.rows.map(row => row.agent))], models: [...new Set(input.rows.map(row => row.model))], tasks: [...new Set(input.rows.map(row => row.task))] })
await writeFile(indexPath, JSON.stringify(index, null, 2))
console.log(`Added ${input.job} to the public build catalog. Run bun run build:public to rebuild.`)
