/**
 * Build the standalone HyperFrames composition used by both the Studio player
 * and the file exporter. The data still comes from the same pure poster
 * functions as the static image, so animation cannot change the result.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { buildPanel, labelLines, PANELS, POSTER_MAX_SERIES } from '../../src/charts/poster'
import { barLabelLines, builtInCopy, tickKey } from '../../src/charts/motion-copy'
import { motionTheme, type MotionTheme } from '../../src/charts/motion-themes'
import type { JobExport } from '../../src/charts/trial'
import { COMPLETION_DEFAULTS, motionCanvas, type CompletionOptions } from '../../src/charts/motion-options'

export { COMPLETION_CONTROLS, COMPLETION_DEFAULTS, completionOptions, completionTiming, type CompletionOptions } from '../../src/charts/motion-options'
export { MOTION_THEMES, THEME_IDS, type ThemeId } from '../../src/charts/motion-themes'
export { CANVAS_IDS, MOTION_CANVASES, motionCanvas, type CanvasId } from '../../src/charts/motion-options'

export const COMPLETION_VIDEO = {
  width: 1600,
  height: 900,
  duration: 8,
  fps: 30,
  finalFrameAt: 7.9,
} as const

const REPORT_ASSETS = new URL('../report/assets/', import.meta.url)
const FONT_CACHE = new URL('../report/.fontcache/', import.meta.url)

const esc = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')

const localFont = (name: string, weight: number, file: string) =>
  `@font-face{font-family:'${name}';font-weight:${weight};font-style:normal;src:url(data:font/otf;base64,${readFileSync(join(REPORT_ASSETS.pathname, file)).toString('base64')}) format('opentype');}`

async function inlineFonts(theme: MotionTheme): Promise<string> {
  // FH Oscar Pro is licensed to Merge, so an unbranded theme must not ship it.
  const oscar = theme.oscar
    ? [
      localFont('FH Oscar Pro', 500, 'FHOscarPro-Medium.otf'),
      localFont('FH Oscar Pro', 600, 'FHOscarPro-SemiBold.otf'),
    ].join('\n')
    : ''
  const cache = join(FONT_CACHE.pathname, 'merge-faces.css')
  if (existsSync(cache)) return `${oscar}\n${readFileSync(cache, 'utf8')}`

  try {
    const css = await fetch('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap', {
      headers: { 'user-agent': 'Mozilla/5.0 AppleWebKit/537.36 Chrome/140 Safari/537.36' },
    }).then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response.text()
    })
    const urls = [...new Set([...css.matchAll(/url\((https:[^)]+\.woff2)\)/g)].map((match) => match[1]))]
    const data = new Map<string, string>()
    await Promise.all(urls.map(async (url) => {
      const bytes = Buffer.from(await fetch(url).then((response) => response.arrayBuffer()))
      data.set(url, `data:font/woff2;base64,${bytes.toString('base64')}`)
    }))
    const inlined = css.replace(/url\((https:[^)]+\.woff2)\)/g, (_match, url: string) => `url(${data.get(url) ?? url})`)
    mkdirSync(FONT_CACHE.pathname, { recursive: true })
    writeFileSync(cache, inlined)
    return `${oscar}\n${inlined}`
  } catch (error) {
    console.warn(`Could not fetch Inter (${(error as Error).message}); using the embedded Oscar faces and system sans.`)
    return oscar
  }
}

export async function completionComposition(exp: JobExport, options: CompletionOptions = COMPLETION_DEFAULTS): Promise<string> {
  if (!Array.isArray(exp.rows) || !exp.rows.length) throw new Error('Heval job export has no rows')
  const order = [...new Set(exp.rows.map((row) => row.modelShort))].sort()
  if (order.length > POSTER_MAX_SERIES) throw new Error(`${order.length} models exceeds the ${POSTER_MAX_SERIES}-series poster limit`)

  // The axis is scoped to the video. PANELS.completion stays pinned to a 0..1
  // zero baseline for the poster and report; the editor's ceiling only ever
  // changes what the composition draws.
  const panel = buildPanel(
    exp.rows,
    { ...PANELS.completion, axisMax: options.axisMax, axisMin: options.axisMin, tickStep: options.tickStep || undefined },
    order,
  )
  // The same function the editor shows as its placeholders, so what a blank
  // slot draws is exactly what the editor said it would.
  const built = builtInCopy(exp.rows, exp.job, order.length, panel.panel.better)
  const copy = {
    title: options.title || built.title,
    kicker: options.kicker || built.kicker,
    cue: options.cue || built.cue,
    note: options.note || built.note,
    source: options.source || built.source,
  }
  // The chart furniture fades in together. Built here rather than as two
  // string literals in the timeline so an optional part cannot be added to one
  // branch and forgotten in the other; GSAP warns on a selector that matches
  // nothing, so an omitted element must be omitted from the list too.
  const scaffold = [
    '.panel-eyebrow',
    ...(options.plotRule ? ['.panel-rule'] : []),
    '.ticks',
    ...(options.gridLines ? ['.grid'] : []),
    '.bar-labels',
  ]
  const frame = motionCanvas(options.canvas)
  // Type only. Padding stays put; the canvas preset changes the frame the
  // flex plot fills, not the type ladder.
  const type = (px: number) => `${(px * options.typeScale).toFixed(2)}px`
  // The timeline is authored against an 8-second runtime, so every cue is
  // expressed as a share of it. Without this a 5-second export would end before
  // the leader turns accent at 5.15s.
  const beat = (options.duration / 8).toFixed(4)
  const theme = motionTheme(options.theme)
  // A blank slot keeps the theme's mark; an unbranded theme has none, so this
  // is also how a plain frame gets a wordmark at all.
  const wordmark = options.wordmark || theme.wordmark
  const fonts = await inlineFonts(theme)
  // Both are Merge marks; a theme that does not want them never loads the file.
  const brandBg = theme.pattern > 0
    ? `data:image/svg+xml;base64,${readFileSync(join(REPORT_ASSETS.pathname, 'brand-bg.svg')).toString('base64')}`
    : ''
  const lockup = theme.lockup ? readFileSync(join(REPORT_ASSETS.pathname, 'merge-lockup.svg'), 'utf8') : ''

  // An override changes a tick's text, never where the scale puts it.
  const ticks = panel.ticks
    .map((tick) => {
      const label = options.tickLabels?.[tickKey(tick.value)] || tick.label
      return `<span class="tick" style="bottom:${(tick.frac * 100).toFixed(3)}%">${esc(label)}</span>`
    })
    .join('')
  // One rule per tick, in a layer behind the bars. The bottom tick sits on the
  // baseline the `.bars` border already draws, so it is skipped rather than
  // doubling that line up.
  const grid = options.gridLines
    ? `<div class="grid">${panel.ticks
      .filter((tick) => tick.frac > 0)
      .map((tick) => `<span style="bottom:${(tick.frac * 100).toFixed(3)}%"></span>`)
      .join('')}</div>`
    : ''
  const bars = panel.bars.map((bar, index) => {
    const finalColor = theme.series[index === 0 ? 0 : 1]
    // A fixed value label is drawn as-is and flagged for the timeline, which
    // then leaves the counter off it. The bar height still comes from the data.
    const fixed = options.valueLabels?.[bar.key]
    return `<div class="bar-col" data-key="${esc(bar.key)}" data-value="${bar.value}" data-rank="${index}"${fixed ? ' data-fixed-value="1"' : ''}>
      <div class="bar-value">${esc(fixed || panel.panel.format(bar.value))}</div>
      <div class="bar" style="height:${(bar.frac * 100).toFixed(3)}%;background:${finalColor}"></div>
    </div>`
  }).join('\n')
  // The model names get their own row under the plot. Inside .bar-col they took
  // column height below the bar, so a bar's percentage height resolved against
  // the full column while the tick scale did not: every bar sat ~9 points high
  // against its own gridlines. Out here the bars share the ticks' baseline.
  const names = panel.bars.map((bar) => {
    // An override replaces the derived name for this bar only. Keys that match
    // no bar never reach here, so a stale override cannot add a column.
    const override = options.barLabels?.[bar.key]
    const lines = (override ? barLabelLines(override) : labelLines(bar.key))
      .map((line) => `<span>${esc(line)}</span>`).join('')
    return `<div class="bar-labels" data-key="${esc(bar.key)}">${lines}</div>`
  }).join('\n')

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=${frame.width}, height=${frame.height}">
  <title>${esc(copy.title)}</title>
  <style>
${fonts}
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: ${frame.width}px; height: ${frame.height}px; overflow: hidden; background: ${theme.surface}; }
body { color: ${theme.ink.primary}; font-family: ${theme.body}; font-synthesis: none; font-variant-ligatures: none; font-feature-settings: 'liga' 0, 'calt' 0; -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
.composition { position: relative; width: 100%; height: 100%; overflow: hidden; background: ${theme.surface}; }
${theme.pattern > 0 ? `.composition::before { content: ''; position: absolute; inset: 0; z-index: 0; background: url('${brandBg}') center / cover no-repeat; opacity: ${theme.pattern}; pointer-events: none; }` : ''}
.scene { position: absolute; inset: 0; z-index: 1; display: flex; flex-direction: column; padding: 67.5px 67.5px 48.75px; }
.brand { height: 39px; display: flex; align-items: center; gap: 18.75px; }
.brand svg { width: auto; height: ${type(28.5)}; display: block; }
.brand-product { font-size: ${type(21.75)}; font-weight: 400; letter-spacing: -.01em; }
.title { margin-top: 40.5px; font-family: ${theme.display}; font-size: ${type(51)}; font-weight: 500; letter-spacing: -.03em; line-height: 1; }
.kicker { margin-top: 15px; color: ${theme.ink.muted}; font-size: ${type(14.25)}; font-weight: 400; }
.panel { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; margin-top: 18px; }
.panel-eyebrow { margin-top: 14px; color: ${theme.ink.good}; font-size: ${type(12.75)}; font-weight: 500; }
.panel-rule { margin-top: 10px; height: 1px; background: ${theme.ink.line}; }
.plot { flex: 1; display: flex; gap: 13.5px; margin-top: 18px; min-height: 0; }
.ticks { position: relative; width: ${type(43.5)}; flex: none; color: ${theme.ink.muted}; font-size: ${type(12.3)}; font-variant-numeric: tabular-nums; }
.tick { position: absolute; right: 0; transform: translateY(${options.tickOffset}%); white-space: nowrap; }
.bars { position: relative; flex: 1; display: flex; align-items: flex-end; justify-content: space-between; gap: 16.5px; min-width: 0; border-bottom: 1px solid ${theme.ink.line}; }
/* Behind the bars, so a rule never crosses a data mark. The bars are the only
   positioned siblings that follow it, hence the explicit stacking. */
.grid { position: absolute; inset: 0; z-index: 0; pointer-events: none; }
.grid span { position: absolute; left: 0; right: 0; height: 1px; background: ${theme.ink.line}; opacity: .55; }
.bar-col { position: relative; z-index: 1; flex: 1; display: flex; flex-direction: column; justify-content: flex-end; height: 100%; min-width: 0; }
.xaxis { display: flex; gap: 13.5px; }
.xaxis-gutter { width: ${type(43.5)}; flex: none; }
.bar-names { flex: 1; display: flex; justify-content: space-between; gap: 16.5px; min-width: 0; }
.bar-value { padding-bottom: 6.75px; color: ${theme.ink.muted}; font-size: ${type(18.75)}; font-weight: 500; letter-spacing: -.01em; text-align: center; white-space: nowrap; font-variant-numeric: tabular-nums; }
.bar-col:first-child .bar-value { color: ${theme.ink.primary}; font-weight: 600; }
.bar { width: 100%; border-radius: 4.5px 4.5px 0 0; transform-origin: 50% 100%; }
.bar-labels { flex: 1; min-width: 0; padding-top: 10.5px; color: ${theme.ink.secondary}; font-size: ${type(12.3)}; font-weight: 700; line-height: 1.25; text-align: center; }
.bar-labels span { display: block; }
.bar-labels span + span { color: ${theme.ink.muted}; font-weight: 600; }
.foot { margin-top: 36px; padding-top: 17.25px; display: flex; justify-content: space-between; align-items: baseline; gap: 30px; border-top: 1px solid ${theme.ink.line}; color: ${theme.ink.muted}; font-size: ${type(12.3)}; font-weight: 400; }
.foot .caveat { max-width: 60%; }
  </style>
  <script src="./assets/gsap.min.js"></script>
</head>
<body>
  <div id="completion-rate" class="composition" data-composition-id="completion-rate" data-start="0" data-duration="${options.duration}" data-fps="${COMPLETION_VIDEO.fps}" data-width="${frame.width}" data-height="${frame.height}">
    <main id="completion-scene" class="scene clip" data-start="0" data-duration="${options.duration}" data-track-index="0">
      <header>
        <div class="brand">${lockup}${wordmark ? `<span class="brand-product">${esc(wordmark)}</span>` : ''}</div>
        <h1 class="title">${esc(copy.title)}</h1>
        ${copy.kicker ? `<div class="kicker">${esc(copy.kicker)}</div>` : ''}
        ${copy.cue ? `<div class="panel-eyebrow">${esc(copy.cue)}</div>` : ''}
      </header>
      <section class="panel">
        ${options.plotRule ? '<div class="panel-rule"></div>' : ''}
        <div class="plot">
          <div class="ticks">${ticks}</div>
          <div class="bars">${bars}${grid}</div>
        </div>
        <div class="xaxis">
          <div class="xaxis-gutter"></div>
          <div class="bar-names">${names}</div>
        </div>
      </section>
      ${copy.note || copy.source ? `<footer class="foot">${copy.note ? `<span class="caveat">${esc(copy.note)}</span>` : '<span></span>'}${copy.source ? `<span>${esc(copy.source)}</span>` : ''}</footer>` : ''}
    </main>
  </div>
  <script>
    (() => {
      const timeline = gsap.timeline({ paused: true });
      const columns = Array.from(document.querySelectorAll('.bar-col'));
      const revealOrder = [...columns].reverse();
      const neutral = '${theme.series[1]}';
      const accent = '${theme.series[0]}';
      // Every cue below is the share of an 8-second runtime it was authored at,
      // stretched by the editor's duration. t() keeps the numbers readable.
      const beat = ${beat};
      const t = (seconds) => seconds * beat;

      timeline.fromTo('.brand', { opacity: 0, y: -10 }, { opacity: 1, y: 0, duration: t(.45), ease: 'power2.out' }, t(.1));
      timeline.fromTo('.title', { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: t(.55), ease: 'power3.out' }, t(.25));
      timeline.fromTo('.kicker', { opacity: 0 }, { opacity: 1, duration: t(.35), ease: 'power1.out' }, t(.55));
      timeline.fromTo(${JSON.stringify(scaffold)}, { opacity: 0 }, { opacity: 1, duration: t(.45), ease: 'power2.out' }, t(.8));
      timeline.set('.bar', { scaleY: 0, backgroundColor: neutral }, 0);
      timeline.set('.bar-value', { opacity: 0 }, 0);
      timeline.set('.foot', { opacity: 0 }, 0);

      revealOrder.forEach((column, index) => {
        const bar = column.querySelector('.bar');
        const label = column.querySelector('.bar-value');
        const finalValue = Number(column.dataset.value);
        const counter = { value: 0 };
        const at = t(1.35 + index * .58);
        timeline.to(bar, { scaleY: 1, duration: t(.92), ease: 'power3.out' }, at);
        timeline.to(label, { opacity: 1, duration: t(.2), ease: 'power1.out' }, at + t(.08));
        // An overridden label is a caption, not a measurement, so it does not
        // count up to a number it does not show.
        if (column.dataset.fixedValue) return;
        timeline.to(counter, {
          value: finalValue,
          duration: t(.92),
          ease: 'power3.out',
          onUpdate: () => { label.textContent = Math.round(counter.value * 100) + '%'; },
        }, at);
      });

      const leader = columns[0];
      timeline.to(leader.querySelector('.bar'), { backgroundColor: accent, duration: t(.42), ease: 'power2.out' }, t(5.15));
      timeline.fromTo(leader, { filter: 'brightness(1)' }, { filter: 'brightness(1.12)', duration: t(.2), repeat: 1, yoyo: true, ease: 'power1.inOut' }, t(5.15));
      timeline.fromTo('.foot', { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: t(.45), ease: 'power2.out' }, t(5.45));

      window.__timelines = window.__timelines || {};
      window.__timelines['completion-rate'] = timeline;
    })();
  </script>
</body>
</html>`
}

/** Render straight from a normalized job export on disk. */
export async function completionCompositionFor(inputPath: string, options: CompletionOptions = COMPLETION_DEFAULTS): Promise<string> {
  return completionComposition(JSON.parse(readFileSync(inputPath, 'utf8')) as JobExport, options)
}

export async function writeCompletionComposition(
  inputPath: string,
  outputRoot = 'results/harbor/social',
  options: CompletionOptions = COMPLETION_DEFAULTS,
): Promise<{ directory: string; file: string; job: string }> {
  const exp = JSON.parse(readFileSync(inputPath, 'utf8')) as JobExport
  const directory = resolve(outputRoot, exp.job)
  const file = join(directory, 'index.html')
  const assets = join(directory, 'assets')
  mkdirSync(assets, { recursive: true })
  copyFileSync(resolve(import.meta.dirname, '../../node_modules/gsap/dist/gsap.min.js'), join(assets, 'gsap.min.js'))
  writeFileSync(file, await completionComposition(exp, options))
  return { directory, file, job: exp.job }
}
