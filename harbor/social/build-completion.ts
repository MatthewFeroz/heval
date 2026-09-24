if (process.env.HEVAL_PUBLIC_BUILD === '1') process.exit(0)
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { writeCompletionComposition } from './completion'

const input = process.argv[2] ?? 'results/harbor/demo-evaluation.json'
if (!existsSync(input)) {
  console.error(`No such Heval job export: ${input}`)
  process.exit(2)
}

const output = await writeCompletionComposition(resolve(input))
console.log(`${input} -> ${output.file}`)
