import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { writeCompletionComposition } from './completion'

const input = process.argv[2] ?? 'results/harbor/terminal-bench-comparison.json'
if (!existsSync(input)) {
  console.error(`No such Heval job export: ${input}`)
  process.exit(2)
}

const output = await writeCompletionComposition(resolve(input))
console.log(`${input} -> ${output.file}`)
