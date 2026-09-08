import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderPosters } from '../../server/social-posters'
import { socialSettings } from '../../src/charts/social-presets'
import { parseMotionInput } from '../../src/project/motion-input'
const [inputPath, settingsPath, outDir = 'results/harbor/threads/latest'] = process.argv.slice(2)
if (!inputPath) throw new Error('Usage: bun run thread <job.json> [settings.json] [out-directory]')
const input = parseMotionInput(JSON.parse(readFileSync(inputPath, 'utf8')))
const settings = socialSettings(settingsPath ? JSON.parse(readFileSync(settingsPath, 'utf8')) : undefined)
mkdirSync(outDir, { recursive: true })
const result = await renderPosters(input, settings, true)
writeFileSync(join(outDir, result.filename), result.bytes)
console.log(join(outDir, result.filename))
