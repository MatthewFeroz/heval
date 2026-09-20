import { PRESENTATION_DEFAULT_THEME } from '../src/charts/presentation-defaults'
import { SOCIAL_THEMES } from '../src/charts/social-themes'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join, resolve, sep, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { socialSvg, SOCIAL_RENDERER_VERSION } from '../src/charts/social-render'
import { resolveSocial, type SocialSettings, type SocialChart } from '../src/charts/social-presets'
import type { JobExport } from '../src/charts/trial'
import { acquireExport } from './export-lock'
const root = process.env.HEVAL_RENDER_ROOT || resolve(import.meta.dirname, '..')
const layoutScript = readFileSync(join(root, 'harbor/report/layout-check.js'), 'utf8')
const assets = join(root, 'harbor/report/assets')
const logo = readFileSync(join(assets, 'merge-lockup.svg'), 'utf8')
const fonts =
  [500, 600]
    .map(
      (weight, i) =>
        '@font-face{font-family:"FH Oscar Pro";font-weight:' +
        weight +
        ';src:url(data:font/otf;base64,' +
        readFileSync(
          join(assets, ['FHOscarPro-Medium.otf', 'FHOscarPro-SemiBold.otf'][i]),
        ).toString('base64') +
        ')}',
    )
    .join('')
const plainFonts = readFileSync(join(assets, 'inter.css'), 'utf8')
export function posterDocuments(input: JobExport, settings: SocialSettings) {
  const chart = resolveSocial(input.rows, settings)
  return {
    chart,
    pages: Array.from(
      {
        length:
          chart.preset === 'disagreement' ? Math.max(1, Math.ceil(chart.matrix.length / 12)) : 1,
      },
      (_, page) =>
        '<!doctype html><html lang="en"><meta charset="utf-8"><style>' +
        (SOCIAL_THEMES[settings.theme ?? PRESENTATION_DEFAULT_THEME].brand ? fonts + plainFonts : plainFonts) +
        'html,body{margin:0;background:' +
        SOCIAL_THEMES[settings.theme ?? PRESENTATION_DEFAULT_THEME].surface +
        '}svg{font-feature-settings:"liga" 0,"calt" 0;display:block;width:100%;height:auto}</style>' +
        socialSvg(chart, settings, logo, page) +
        '<script>' +
        layoutScript +
        '</script></html>',
    ),
  }
}
async function screenshot(htmlPath: string, pngPath: string) {
  await new Promise<void>((done, fail) => {
    const child = spawn(
      process.versions.bun ? 'node' : process.execPath,
      [join(root, 'harbor/report/render-poster.mjs')],
      {
        windowsHide: true,
        stdio: ['pipe', 'ignore', 'pipe'],
      },
    )
    let error = ''
    child.stderr.on('data', (chunk) => {
      error = (error + chunk).slice(-4000)
    })
    const timer = setTimeout(() => {
      child.kill()
      fail(new Error('PNG rendering timed out'))
    }, 45000)
    child.on('error', (e) => {
      clearTimeout(timer)
      fail(e)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) done()
      else fail(new Error(error || 'PNG rendering failed'))
    })
    child.stdin.on('error', () => {})
    child.stdin.end(JSON.stringify({ htmlPath, pngPath, width: 1600, height: 900 }))
  })
}
/** Store-only ZIP: PNGs are already compressed. No shell or platform dependency. */
export function zipFiles(files: { name: string; bytes: Uint8Array }[]): Uint8Array {
  const chunks: Buffer[] = [],
    directory: Buffer[] = []
  let offset = 0
  for (const f of files) {
    const name = Buffer.from(f.name),
      bytes = Buffer.from(f.bytes)
    let crc = 0xffffffff
    for (const b of bytes) {
      crc ^= b
      for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
    crc = (crc ^ 0xffffffff) >>> 0
    const h = Buffer.alloc(30)
    h.writeUInt32LE(0x04034b50)
    h.writeUInt16LE(20, 4)
    h.writeUInt16LE(0x800, 6)
    h.writeUInt32LE(crc, 14)
    h.writeUInt32LE(bytes.length, 18)
    h.writeUInt32LE(bytes.length, 22)
    h.writeUInt16LE(name.length, 26)
    chunks.push(h, name, bytes)
    const c = Buffer.alloc(46)
    c.writeUInt32LE(0x02014b50)
    c.writeUInt16LE(20, 4)
    c.writeUInt16LE(20, 6)
    c.writeUInt16LE(0x800, 8)
    c.writeUInt32LE(crc, 16)
    c.writeUInt32LE(bytes.length, 20)
    c.writeUInt32LE(bytes.length, 24)
    c.writeUInt16LE(name.length, 28)
    c.writeUInt32LE(offset, 42)
    directory.push(c, name)
    offset += h.length + name.length + bytes.length
  }
  const central = Buffer.concat(directory),
    end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(central.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...chunks, central, end])
}
export async function renderPosters(
  input: JobExport,
  settings: SocialSettings,
  collection: boolean,
) {
  const release = acquireExport()
  if (!release)
    throw Object.assign(new Error('Another export is rendering. Try again shortly.'), {
      status: 409,
    })
  let scratch: string | undefined
  try {
    const presets = collection ? settings.collection : [settings.preset]
    // Validate the entire collection before starting any browser processes.
    const documents = presets.map((preset) => posterDocuments(input, { ...settings, preset }))
    scratch = mkdtempSync(join(tmpdir(), 'heval-poster-export-'))
    const files: { name: string; bytes: Uint8Array }[] = []
    const charts: SocialChart[] = []
    for (const { chart, pages } of documents) {
      charts.push(chart)
      for (let i = 0; i < pages.length; i++) {
        const stem = chart.preset + (pages.length > 1 ? '-' + (i + 1) : '')
        const htmlPath = join(scratch, stem + '.html'),
          pngPath = join(scratch, stem + '.png')
        writeFileSync(htmlPath, pages[i])
        await screenshot(htmlPath, pngPath)
        files.push({ name: stem + '.png', bytes: readFileSync(pngPath) })
      }
    }
    if (!collection && files.length === 1)
      return { bytes: files[0].bytes, type: 'image/png', filename: files[0].name }
    const manifest = {
      renderer: SOCIAL_RENDERER_VERSION,
      theme: settings.theme ?? PRESENTATION_DEFAULT_THEME,
      generatedAt: new Date().toISOString(),
      inputHash: createHash('sha256').update(JSON.stringify(input)).digest('hex'),
      settings,
      charts,
      input,
    }
    files.push({ name: 'manifest.json', bytes: Buffer.from(JSON.stringify(manifest, null, 2)) })
    const csv = [
      'preset,model,value,timeouts,trials',
      ...charts.flatMap((c) =>
        c.bars.map((b) =>
          [c.preset, b.key, b.value ?? '', b.timeout, b.n]
            .map((v) => '"' + String(v).replace(/"/g, '""') + '"')
            .join(','),
        ),
      ),
    ].join('\n')
    files.push({ name: 'values.csv', bytes: Buffer.from(csv) })
    return {
      bytes: zipFiles(files),
      type: 'application/zip',
      filename: 'merge-evaluations-thread.zip',
    }
  } finally {
    try {
      if (scratch) removeScratch(scratch)
    } finally {
      release()
    }
  }
}

function removeScratch(scratch: string) {
  const target = resolve(scratch)
  if (
    !target.startsWith(resolve(tmpdir()) + sep) ||
    !basename(target).startsWith('heval-poster-export-')
  )
    throw new Error('Invalid scratch path')
  rmSync(target, { recursive: true, force: true })
}
