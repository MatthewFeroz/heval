import { resolve } from 'node:path'
import { supervise } from './runner/supervisor'
const directory = process.argv[2]
if (!directory) throw new Error('Internal runner supervisor requires an execution directory.')
await supervise(resolve(directory))
