import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import {
  COMPLETION_DEFAULTS,
  COMPLETION_VIDEO,
  completionCompositionFor,
  completionTiming,
  type CompletionOptions,
} from '../harbor/social/completion'

export const SOCIAL_FORMATS = ['mp4', 'png', 'jpeg'] as const
export type SocialFormat = (typeof SOCIAL_FORMATS)[number]

export type SocialExport = {
  bytes: Uint8Array
  filename: string
  type: string
}

export class SocialExportError extends Error {
  constructor(message: string, readonly status = 500) {
    super(message)
  }
}

const root = resolve(import.meta.dirname, '..')
const hyperframes = join(root, 'node_modules/.bin/hyperframes')
let rendering = false

function catalogJobs(): Set<string> {
  const index = JSON.parse(readFileSync(join(root, 'results/harbor/index.json'), 'utf8')) as { jobs?: { job?: string }[] }
  return new Set((index.jobs ?? []).map((entry) => entry.job).filter((job): job is string => typeof job === 'string'))
}

function inputFor(job: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(job) || !catalogJobs().has(job)) throw new SocialExportError('Unknown Heval job', 404)
  const input = join(root, 'results/harbor', `${job}.json`)
  if (!existsSync(input)) throw new SocialExportError('The normalized job export is missing', 404)
  return input
}

const gsapSource = join(root, 'node_modules/gsap/dist/gsap.min.js')

/** Put gsap.min.js next to the composition URL the player loads. */
function ensureCompositionAssets(directory: string): void {
  const assets = join(directory, 'assets')
  mkdirSync(assets, { recursive: true })
  const file = join(assets, 'gsap.min.js')
  if (!existsSync(file)) copyFileSync(gsapSource, file)
}

/**
 * The composition the player loads is generated per request and never written
 * to the shared results/ directory: the editor's sliders mean two requests can
 * want different HTML at the same path, and a render reading a file another
 * request had just overwritten would silently export the wrong frame.
 */
export async function compositionHtml(job: string, options: CompletionOptions = COMPLETION_DEFAULTS): Promise<string> {
  const input = inputFor(job)
  ensureCompositionAssets(join(root, 'results/harbor/social', job))
  return completionCompositionFor(input, options)
}

export function socialCompositionAsset(job: string, asset: string): string {
  inputFor(job)
  if (asset !== 'gsap.min.js') throw new SocialExportError('Unknown composition asset', 404)
  ensureCompositionAssets(join(root, 'results/harbor/social', job))
  return join(root, 'results/harbor/social', job, 'assets', asset)
}

async function command(argv: string[], cwd: string): Promise<void> {
  const proc = Bun.spawn(argv, {
    cwd,
    env: { ...process.env, HYPERFRAMES_NO_TELEMETRY: '1', DO_NOT_TRACK: '1' },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (code !== 0) {
    const detail = stderr.trim() || stdout.trim() || `process exited ${code}`
    throw new SocialExportError(detail.split('\n').slice(-8).join('\n'))
  }
}

async function finalPng(compositionDir: string, scratch: string, finalFrameAt: number): Promise<string> {
  const snapshots = join(scratch, 'snapshots')
  await command([
    hyperframes,
    'snapshot',
    compositionDir,
    '--at',
    String(finalFrameAt),
    '--no-end',
    '--output',
    snapshots,
  ], root)
  const frame = readdirSync(snapshots).find((file) => file.endsWith('.png'))
  if (!frame) throw new SocialExportError('HyperFrames did not create the requested snapshot')
  return join(snapshots, frame)
}

export async function renderSocialExport(
  job: string,
  format: SocialFormat,
  options: CompletionOptions = COMPLETION_DEFAULTS,
): Promise<SocialExport> {
  if (rendering) throw new SocialExportError('Another social export is rendering. Try again in a moment.', 409)
  rendering = true
  const scratch = mkdtempSync(join(tmpdir(), 'heval-social-export-'))
  try {
    // Render from a private copy so the exported file matches the options this
    // request asked for, whatever else is being previewed.
    const compositionDir = join(scratch, 'composition')
    mkdirSync(compositionDir, { recursive: true })
    ensureCompositionAssets(compositionDir)
    writeFileSync(join(compositionDir, 'index.html'), await completionCompositionFor(inputFor(job), options))
    const stem = `${job}-completion-${options.canvas}`

    if (format === 'mp4') {
      const output = join(scratch, `${stem}.mp4`)
      await command([
        hyperframes,
        'render',
        compositionDir,
        '--output',
        output,
        '--fps',
        String(COMPLETION_VIDEO.fps),
        '--quality',
        'high',
        '--workers',
        '1',
        '--strict',
        '--no-best-effort',
      ], root)
      return { bytes: readFileSync(output), filename: basename(output), type: 'video/mp4' }
    }

    const png = await finalPng(compositionDir, scratch, completionTiming(options).finalFrameAt)
    if (format === 'png') return { bytes: readFileSync(png), filename: `${stem}.png`, type: 'image/png' }

    const jpeg = join(scratch, `${stem}.jpg`)
    await command(['ffmpeg', '-y', '-i', png, '-q:v', '2', jpeg], root)
    return { bytes: readFileSync(jpeg), filename: basename(jpeg), type: 'image/jpeg' }
  } finally {
    rmSync(scratch, { recursive: true, force: true })
    rendering = false
  }
}
