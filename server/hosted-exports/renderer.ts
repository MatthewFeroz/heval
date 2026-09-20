// Bundled into the immutable Sandbox snapshot; never handles network credentials.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderPosters } from '../social-posters'
import { parseMotionInput } from '../../src/project/motion-input'
import { socialSettings } from '../../src/charts/social-presets'
const root = process.env.HEVAL_RENDER_ROOT!
const payload = JSON.parse(readFileSync(join(root, 'input.json'), 'utf8'))
const output = await renderPosters(parseMotionInput(payload.input), socialSettings(payload.settings), payload.collection === true)
if (output.bytes.length > 20_000_000) throw new Error('Export exceeds 20 MB')
writeFileSync(join(root, 'output.bin'), output.bytes)
writeFileSync(join(root, 'output.json'), JSON.stringify({ filename: output.filename, type: output.type, size: output.bytes.length }))
