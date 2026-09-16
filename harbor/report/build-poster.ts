import { fileURLToPath } from 'node:url'
/**
 * Normalized job -> individual poster graphs, sized for a social post.
 *
 *   bun harbor/report/build-poster.ts results/harbor/terminal-bench-comparison.json
 *   bun run poster results/harbor/terminal-bench-comparison.json --open-weight
 *
 * Writes, under results/harbor/posters/<job>/ (override with --out <dir>):
 *
 *   <job>-<panel>.png    one graph per panel, the individual export
 *   <job>-<panel>.html   the same graph as markup, if you want to nudge it
 *   <job>-poster.png     all requested panels in one frame (--combined)
 *
 * The panel statistics come from src/charts/metrics.ts - the module the static
 * report derives its own headline numbers from - so a poster and the report it
 * was cut from cannot disagree. Layout and palette come from
 * src/charts/poster.ts. This file is only the rendering: markup, fonts, and the
 * headless screenshot.
 *
 * PNG rather than SVG because that is what the platforms accept. Chromium
 * rasterizes it (Playwright is already a dev dependency for the e2e suite), so
 * the text is laid out by a real font engine rather than Vega's estimator - a
 * poster is mostly type, and the estimator's ~10% error is visible at 48px.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { nums } from '../../src/charts/metrics'
import {
  buildPanel,
  labelLines,
  PANEL_IDS,
  PANELS,
  POSTER_INK,
  POSTER_MAX_SERIES,
  POSTER_COMPARISON_SERIES,
  POSTER_WINNER,
  POSTER_SURFACE,
  type PanelData,
  type PanelId,
} from '../../src/charts/poster'
import type { JobExport, TrialRow } from '../../src/charts/trial'

/**
 * Direction cue for the "higher / lower is better" label, lucide `arrow-up` and
 * `arrow-down`, inlined the way build-report.ts inlines its icons so the frame
 * stays one self-contained file.
 *
 * No width or height here: the CSS sizes them in `em` so they track the label's
 * font-size, and `currentColor` keeps them on the label's ink. POSTER_INK.good
 * and .muted are the same value on purpose, so direction is carried by which
 * way the arrow points rather than by a second accent colour.
 */
const LUCIDE = (paths: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`
const ARROW_UP = LUCIDE('<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>')
const ARROW_DOWN = LUCIDE('<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>')

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// -- fonts ----------------------------------------------------------------------

/**
 * Google Fonts, fetched once and inlined as base64.
 *
 * The report links the stylesheet and lets the reader's browser fetch it. A
 * poster cannot: the PNG is rasterized at build time, so a font that has not
 * arrived is a font that is silently missing from the artifact, and the fallback
 * metrics are different enough that the layout shifts rather than just looking
 * plainer. Cached on disk so a poster rebuilt offline still gets real type.
 */
const FONT_CACHE = new URL('.fontcache/', import.meta.url)
const ASSETS = new URL('assets/', import.meta.url)
const FONT_FACES = [
  { family: 'Inter', weights: '400;500;600;700' },
]

const localFont = (name: string, weight: number, file: string) =>
  `@font-face{font-family:'${name}';font-weight:${weight};font-style:normal;src:url(data:font/otf;base64,${readFileSync(join(fileURLToPath(ASSETS), file)).toString('base64')}) format('opentype');}`

const OSCAR_FONTS = [
  localFont('FH Oscar Pro', 500, 'FHOscarPro-Medium.otf'),
  localFont('FH Oscar Pro', 600, 'FHOscarPro-SemiBold.otf'),
].join('\n')

async function inlineFonts(): Promise<string> {
  const cache = join(fileURLToPath(FONT_CACHE), 'merge-faces.css')
  if (existsSync(cache)) return `${OSCAR_FONTS}\n${readFileSync(cache, 'utf8')}`

  const query = FONT_FACES.map((f) => `family=${f.family.replace(/ /g, '+')}:wght@${f.weights}`).join('&')
  const url = `https://fonts.googleapis.com/css2?${query}&display=swap`
  try {
    // A modern UA is what makes Google serve woff2 rather than legacy formats.
    const css = await fetch(url, {
      headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36' },
    }).then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return r.text()
    })
    const urls = [...new Set([...css.matchAll(/url\((https:[^)]+\.woff2)\)/g)].map((m) => m[1]))]
    const data = new Map<string, string>()
    await Promise.all(
      urls.map(async (u) => {
        const buf = Buffer.from(await fetch(u).then((r) => r.arrayBuffer()))
        data.set(u, `data:font/woff2;base64,${buf.toString('base64')}`)
      }),
    )
    const inlined = css.replace(/url\((https:[^)]+\.woff2)\)/g, (_m, u: string) => `url(${data.get(u) ?? u})`)
    mkdirSync(fileURLToPath(FONT_CACHE), { recursive: true })
    writeFileSync(cache, inlined)
    return `${OSCAR_FONTS}\n${inlined}`
  } catch (e) {
    console.warn(`! could not fetch webfonts (${(e as Error).message}); falling back to system fonts.`)
    console.warn('  FH Oscar Pro is embedded; Inter will use the system sans-serif fallback.')
    return OSCAR_FONTS
  }
}

const BRAND_BG = `data:image/svg+xml;base64,${readFileSync(join(fileURLToPath(ASSETS), 'brand-bg.svg')).toString('base64')}`
const MERGE_LOCKUP = readFileSync(join(fileURLToPath(ASSETS), 'merge-lockup.svg'), 'utf8')

// -- sizes ----------------------------------------------------------------------

/**
 * The two shapes worth exporting.
 *
 * `square` is the LinkedIn and in-feed shape and the default for a single
 * graph; `landscape` is 16:9 for X and for the multi-panel frame, which needs
 * the width. Nothing here is 1.91:1 - a link-preview crop is a different job
 * and would cut the axis labels off this layout.
 */
const SIZES = {
  square: { w: 1200, h: 1200 },
  landscape: { w: 1600, h: 900 },
} as const
type SizeName = keyof typeof SIZES

// -- markup ---------------------------------------------------------------------

/** Scales the whole type and spacing ladder off one number, so both sizes agree. */
type Scale = { unit: number; panels: number }

function css(fonts: string, size: { w: number; h: number }, s: Scale): string {
  const u = (n: number) => `${(n * s.unit).toFixed(2)}px`
  return `${fonts}
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: ${size.w}px; height: ${size.h}px; }
body {
  background: ${POSTER_SURFACE};
  color: ${POSTER_INK.primary};
  font-family: 'Inter', system-ui, sans-serif;
  font-synthesis: none;
  font-variant-ligatures: none;
  font-feature-settings: 'liga' 0, 'calt' 0;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  display: flex;
  flex-direction: column;
  padding: ${u(4.5)} ${u(4.5)} ${u(3.25)};
  position: relative;
  overflow: hidden;
}
body::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 0;
  background: url('${BRAND_BG}') center / cover no-repeat;
  opacity: 0.32;
  pointer-events: none;
}
body > * { position: relative; z-index: 1; }
.brand {
  height: ${u(2.6)};
  display: flex;
  align-items: center;
  gap: ${u(1.25)};
}
.brand svg { width: auto; height: ${u(1.9)}; display: block; }
.large-brand .brand { height: ${u(5.2)}; gap: ${u(2)}; }
.large-brand .brand svg { height: ${u(3.8)}; }
.large-brand .brand-product { font-size: ${u(2.9)}; }
.no-brand .title { margin-top: 0; }
/* --brand-right: title and lockup on one line, headline left, brand right.
   row-reverse rather than reordered markup, so the lockup stays first in the
   document for anything reading the frame as text. */
.brand-right header {
  display: flex;
  flex-direction: row-reverse;
  align-items: center;
  justify-content: space-between;
  gap: ${u(3)};
}
.brand-right .brand { height: ${u(3.5)}; gap: ${u(1.7)}; flex: none; }
.brand-right .brand svg { height: ${u(2.9)}; }
.brand-right .brand-product { font-size: ${u(2.15)}; }
.brand-right .title { margin-top: 0; }
.brand-product {
  font-size: ${u(1.45)};
  font-weight: 400;
  letter-spacing: -0.01em;
}
.title {
  margin-top: ${u(2.7)};
  font-family: 'FH Oscar Pro', 'Inter', system-ui, sans-serif;
  font-size: ${u(3.4)};
  font-weight: 500;
  letter-spacing: -0.03em;
  line-height: 1;
}
.kicker {
  margin-top: ${u(1)};
  font-size: ${u(0.95)};
  font-weight: 400;
  color: ${POSTER_INK.muted};
}
.panels {
  flex: 1;
  display: grid;
  grid-template-columns: repeat(${s.panels}, minmax(0, 1fr));
  gap: ${u(4)};
  margin-top: ${u(3.4)};
  min-height: 0;
}
.panel { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.panel-heading { font-family: 'FH Oscar Pro', 'Inter', system-ui, sans-serif; font-size: ${u(1.65)}; font-weight: 500; letter-spacing: -0.02em; }
.single .panel-heading { display: none; }
.panel-eyebrow {
  margin-top: ${u(0.6)};
  display: flex;
  align-items: center;
  gap: ${u(0.38)};
  /* Same size, weight and ink as the source stamp in .foot, so the two bits of
     chrome that frame the plot read as one pair rather than two decisions. */
  font-size: ${u(0.82)};
  font-weight: 400;
  color: ${POSTER_INK.muted};
  letter-spacing: -0.01em;
}
/* Sized in em so the arrow follows the label; --large-text moves both at once. */
.panel-eyebrow svg { width: 1em; height: 1em; flex: none; }
.panel-eyebrow.higher { color: ${POSTER_INK.good}; }
.panel-eyebrow.lower { color: ${POSTER_INK.muted}; }
.panel-note {
  min-height: 1.3em;
  margin-top: ${u(0.35)};
  font-size: ${u(0.9)};
  font-weight: 600;
  color: ${POSTER_INK.muted};
}
.panel-rule { margin-top: ${u(0.9)}; height: 1px; background: ${POSTER_INK.line}; }

/* Plot: a tick gutter on the left, bars in the rest. */
.plot { flex: 1; display: flex; gap: ${u(0.9)}; margin-top: ${u(1.7)}; min-height: 0; }
.ticks {
  position: relative;
  width: ${u(2.9)};
  flex: none;
  font-size: ${u(0.82)};
  color: ${POSTER_INK.muted};
  font-variant-numeric: tabular-nums;
}
.tick { position: absolute; right: 0; transform: translateY(50%); white-space: nowrap; }
.bars {
  flex: 1;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: ${u(1.1)};
  border-bottom: 1px solid ${POSTER_INK.line};
  min-width: 0;
}
.bar-col { flex: 1; position: relative; height: 100%; min-width: 0; }
/* Anchored to the top of its bar and growing upward, so whatever rides above a
   bar - the value, and under --logo-spot above-bar the mark too - stays one
   stack with one gap to the bar. */
.bar-stack {
  position: absolute; width: 100%;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-bottom: ${u(0.45)};
}
.bar-value {
  font-size: ${u(s.panels > 1 ? 1 : 1.25)};
  font-weight: 600;
  letter-spacing: -0.01em;
  text-align: center;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.bar-col:not(.winner) .bar-value { color: ${POSTER_INK.muted}; font-weight: 500; }
/* 4px rounded data-end at the free end only; the baseline end stays square so
   the bar reads as anchored to zero. */
.bar { position: absolute; bottom: 0; border-radius: ${u(0.3)} ${u(0.3)} 0 0; width: 100%; overflow: hidden; }
.axis-labels { display: flex; gap: ${u(1.1)}; margin-left: ${u(3.8)}; min-height: ${u(3.2)}; }
.bar-labels {
  flex: 1; min-width: 0;
  padding-top: ${u(0.7)};
  text-align: center;
  font-size: ${u(0.82)};
  font-weight: 700;
  line-height: 1.25;
  color: ${POSTER_INK.secondary};
}
.bar-labels span { position: relative; left: 50%; width: max-content; transform: translateX(-50%); }
.bar-labels span { display: block; }
.bar-labels span + span { color: ${POSTER_INK.muted}; font-weight: 600; }
.foot {
  margin-top: ${u(2.4)};
  padding-top: ${u(1.15)};
  border-top: 1px solid ${POSTER_INK.line};
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: ${u(2)};
  font-size: ${u(0.82)};
  font-weight: 400;
  color: ${POSTER_INK.muted};
}
.foot .caveat { max-width: 60%; }
.foot .caveat:empty { display: none; }
.foot > span:last-child { margin-left: auto; }
.large-text .panel-heading { font-size: ${u(1.95)}; }
.large-text .panel-eyebrow { font-size: ${u(1.6)}; font-weight: 500; color: ${POSTER_INK.primary}; }
.large-text .ticks { font-size: ${u(1)}; }
.large-text .bar-value { font-size: ${u(1.12)}; }
.large-text .bar-labels { font-size: ${u(0.9)}; letter-spacing: -0.025em; }
.large-text .foot { font-size: ${u(1.6)}; font-weight: 500; color: ${POSTER_INK.primary}; }
.designer { background: #12110F; }
.designer::before { opacity: 0.10; }
.designer .plot { margin-top: ${u(1.7)}; }
.designer .bar-col .bar-value { color: #F5F2EE; font-weight: 600; }
.model-app { width: 100%; aspect-ratio: 1; border-radius: 22%; background: #F5F2EE; color: #181916; display: flex; align-items: center; justify-content: center; margin-bottom: ${u(0.5)}; border: 1px solid #ffffff40; }
.model-app svg { width: 70%; height: 70%; }
.designer .bar-labels { position: relative; font-size: ${u(0.9)}; }
.designer.axis-inline .bar-labels .model-app { position: absolute; left: calc(50% - ${u(2.1)}); top: ${u(1.95)}; width: ${u(0.85)}; height: ${u(0.85)}; margin: 0; border: 0; border-radius: 20%; }
.designer .bar-labels .model-app svg { width: 85%; height: 85%; }
/* The other three placements. A mark that is not crowding the model name can
   be a plain square in the flow, so each of these is a size and a gap. */
/* Names run two or three lines once "5.3 Flash" wraps in a 6-across column;
   reserving three keeps every mark on one row instead of a ragged one. */
.axis-below .bar-labels .model-name { min-height: 3.75em; }
.axis-below .bar-labels .model-app { margin: ${u(0.55)} auto 0; width: ${u(1.4)}; height: ${u(1.4)}; border: 0; border-radius: 20%; }
.axis-below .axis-labels { min-height: ${u(6.2)}; }
.bar-stack .model-app { margin: 0 0 ${u(0.3)}; width: ${u(1.15)}; height: ${u(1.15)}; border: 0; border-radius: 20%; }
/* Headroom for the taller stack: the tallest bar in a panel reaches ~87% of the
   plot, and mark + value no longer fit in the 13% that leaves. */
.above-bar .plot { margin-top: ${u(3.3)}; }
.bar > .model-app {
  position: absolute;
  top: ${u(0.55)};
  left: 50%;
  transform: translateX(-50%);
  margin: 0;
  width: ${u(1.5)};
  height: ${u(1.5)};
  border: 0;
  border-radius: 20%;
}
/* A single square panel spreads six bars over the full frame width, so each bar
   is roughly twice the width it gets in a combined three-panel frame. The mark
   scales with it; at ${u(1.5)} it reads as a speck against a bar that wide. */
.single .bar > .model-app { width: ${u(2.2)}; height: ${u(2.2)}; top: ${u(0.7)}; }
.single .bar-stack .model-app { width: ${u(1.7)}; height: ${u(1.7)}; }
/* Single-panel titles are metric names, short enough to hold one line beside the
   lockup once the header gap stops reserving room a headline would need. */
.single.brand-right header { gap: ${u(2.2)}; }
.single.brand-right .head-text { flex: 1; min-width: 0; }
/* "Cost per success" is the longest of the three metric names and overruns the
   space beside the lockup at the shared ${u(3.4)}; this holds it on one line
   with a real gap rather than letting it crowd the wordmark. */
.single.brand-right .title { white-space: nowrap; font-size: ${u(2.8)}; }
.designer .bar-labels .model-name { flex: 0 0 auto; }
.designer .bar-labels span { position: static; width: auto; transform: none; }
.designer .panel[data-metric='completion'] .panel-heading { color: #ABCAD8; }
.designer .panel[data-metric='cost-per-success'] .panel-heading { color: #C6ADCA; }
.designer .panel[data-metric='median-time'] .panel-heading { color: #96A58D; }
`
}

/**
 * Where the model's mark sits relative to its bar, under --designer.
 *
 *   axis-inline  beside the model name in the axis label (the tightest option)
 *   axis-below   under the model name, centred in the axis label
 *   above-bar    small, stacked over the value label
 *   in-bar       inside the bar, under the value label
 */
const LOGO_SPOTS = ['axis-inline', 'axis-below', 'above-bar', 'in-bar'] as const
type LogoSpot = (typeof LOGO_SPOTS)[number]

/**
 * Bar fraction a mark needs to sit inside the bar rather than over it.
 *
 * The plot is about 25 type units tall at either export size, and the mark plus
 * its inset needs ~2.6 of them. Below this a bar is shorter than its own mark,
 * so that column falls back to the above-bar stack instead of being clipped.
 */
const IN_BAR_MIN_FRAC = 0.15

function modelLogo(model: string): string {
  const brand = model.startsWith('glm') ? 'zai' : model.startsWith('deepseek') ? 'deepseek' : model.startsWith('kimi') ? 'kimi' : 'claude'
  // Z.ai and Kimi ship near-white marks that vanish on the ivory tile, so those
  // two take the monochrome file and inherit the tile's ink.
  const mono = brand === 'zai' || brand === 'kimi'
  return `<div class="model-app">${readFileSync(join(fileURLToPath(ASSETS), 'model-logos', `${brand}${mono ? '' : '-color'}.svg`), 'utf8')}</div>`
}

/**
 * One axis category label: the model name, and the mark if it belongs here.
 *
 * axis-inline sets the mark beside the name, which only fits if the name breaks
 * one word per line; the other placements leave the name on its own and keep
 * the two-line break the label ladder already chose.
 */
function axisLabelHtml(b: PanelData['bars'][number]): string {
  const inline = has('designer') && logoSpot === 'axis-inline'
  const below = has('designer') && logoSpot === 'axis-below'
  const lines = inline ? b.lines.flatMap((line) => line.split(' ')) : b.lines
  const name = `<div class="model-name">${lines.map((l) => `<span>${esc(l)}</span>`).join('')}</div>`
  return `<div class="bar-labels">${inline ? modelLogo(b.key) : ''}${name}${below ? modelLogo(b.key) : ''}</div>`
}

function panelHtml(d: PanelData): string {
  const ticks = d.ticks
    .map((t) => `<div class="tick" style="bottom:${(t.frac * 100).toFixed(3)}%">${esc(t.label)}</div>`)
    .join('')
  const best = d.bars.length
    ? (d.panel.better === 'higher' ? Math.max : Math.min)(...d.bars.map((b) => b.value))
    : null
  let comparisonIndex = 0
  const bars = d.bars
    .map((b) => {
      const winner = b.value === best
      const color = has('designer') ? ({ completion: '#ABCAD8', 'cost-per-success': '#C6ADCA', 'median-time': '#96A58D' }[d.panel.id]) : winner ? POSTER_WINNER : POSTER_COMPARISON_SERIES[comparisonIndex++ % POSTER_COMPARISON_SERIES.length]
      const inBar = logoSpot === 'in-bar' && b.frac >= IN_BAR_MIN_FRAC
      const stacked = logoSpot === 'above-bar' || (logoSpot === 'in-bar' && !inBar)
      const mark = (where: boolean) => (has('designer') && where ? modelLogo(b.key) : '')
      return `        <div class="bar-col${winner ? ' winner' : ''}">
          <div class="bar-stack" style="bottom:${(b.frac * 100).toFixed(3)}%">${mark(stacked)}<div class="bar-value">${esc(d.panel.id === 'cost-per-success' ? `$${b.value.toFixed(2)}` : d.panel.format(b.value))}</div></div>
          <div class="bar" style="height:${(b.frac * 100).toFixed(3)}%;background:${color}">${mark(inBar)}</div>
        </div>`
    })
    .join('\n')
  return `    <section class="panel" data-metric="${d.panel.id}">
      <div class="panel-heading">${esc(d.panel.heading)}</div>
      <div class="panel-eyebrow ${d.panel.better}">${d.panel.better === 'higher' ? ARROW_UP : ARROW_DOWN}<span>${esc(`${d.panel.better[0].toUpperCase()}${d.panel.better.slice(1)} is better`)}</span></div>
      ${has('no-panel-notes') ? '' : `<div class="panel-note">${esc(d.panel.note ?? '')}</div>`}
      <div class="panel-rule"></div>
      <div class="plot">
        <div class="ticks">${ticks}</div>
        <div class="bars">
${bars}
        </div>
      </div>
      <div class="axis-labels">${d.bars.map((b) => axisLabelHtml(b)).join('')}</div>
    </section>`
}

type Frame = {
  title: string
  kicker: string
  source: string
  caveat: string
  panels: PanelData[]
  size: { w: number; h: number }
}

async function frameHtml(f: Frame, fonts: string): Promise<string> {
  // Bar labels get tighter as panels multiply; one knob, applied everywhere.
  const s: Scale = { unit: f.size.h / 60, panels: f.panels.length }
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(f.title || 'Heval model comparison')}</title>
<style>${css(fonts, f.size, s)}</style></head>
<body class="${f.panels.length === 1 ? 'single' : 'combined'}${has('large-text') ? ' large-text' : ''}${has('large-brand') ? ' large-brand' : ''}${has('no-brand') ? ' no-brand' : ''}${has('brand-right') ? ' brand-right' : ''}${has('designer') ? ' designer' : ''} ${logoSpot}">
  <header>
    ${has('no-brand') ? '' : `<div class="brand">${MERGE_LOCKUP}<span class="brand-product">Gateway</span></div>`}
    <div class="head-text">
      ${f.title ? `<h1 class="title">${esc(f.title)}</h1>` : ''}
      ${f.kicker ? `<div class="kicker">${esc(f.kicker)}</div>` : ''}
    </div>
  </header>
  <div class="panels">
${f.panels.map((p) => panelHtml(p)).join('\n')}
  </div>
  ${
    // An empty footer still draws its rule and reserves its padding, which reads
    // as a stray line under the plot. With nothing to say, say nothing.
    f.caveat || f.source
      ? `<footer class="foot">
    <span class="caveat">${esc(f.caveat)}</span>
    ${f.source ? `<span>${esc(f.source)}</span>` : ''}
  </footer>`
      : ''
  }
</body></html>`
}

// -- model selection --------------------------------------------------------------

/**
 * Model creators whose weights are published.
 *
 * A list, not a heuristic, because "open" is a licensing fact about a specific
 * release and nothing in a slug encodes it. Matched against `provider` - the
 * part of the slug before the slash, which is who *made* the model. Add a maker
 * here only after checking the actual release.
 */
const OPEN_WEIGHT_PROVIDERS = new Set(['deepseek', 'zai', 'moonshot', 'meta', 'mistral', 'qwen', 'alibaba', 'nvidia', 'google-deepmind-oss', 'openai-oss'])

const isOpenWeight = (r: TrialRow) => !!r.provider && OPEN_WEIGHT_PROVIDERS.has(r.provider)

// -- cli --------------------------------------------------------------------------

const args = process.argv.slice(2)
/** Flags that consume the next argument. Everything else is a bare switch. */
const VALUED = ['panels', 'size', 'axis-max', 'models', 'exclude', 'title', 'kicker', 'source', 'caveat', 'out', 'logo-spot']
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const has = (name: string) => args.includes(`--${name}`)

const logoSpot = (flag('logo-spot') ?? LOGO_SPOTS[0]) as LogoSpot
if (!LOGO_SPOTS.includes(logoSpot)) {
  console.error(`unknown --logo-spot: ${logoSpot} - pick from ${LOGO_SPOTS.join(', ')}`)
  process.exit(2)
}

const input = args.find((a, i) => {
  if (a.startsWith('--')) return false
  const prev = args[i - 1]
  return !(prev?.startsWith('--') && VALUED.includes(prev.slice(2)))
})
if (!input || has('help')) {
  console.error(`usage: bun harbor/report/build-poster.ts <job.json> [options]

  --panels <ids>     comma-separated, from: ${PANEL_IDS.join(', ')} (default: all)
  --combined         also write every panel in one frame
  --only-combined    write only the combined frame
  --size <name>      ${Object.keys(SIZES).join(' | ')} (default: square single, landscape combined)
  --axis-max <spec>  axis ceiling in the units the ticks print. '80' for every
                     panel, or per panel: 'completion=80,median-time=300'.
                     Default: 100% for completion, fitted for cost and time.
                     Bars keep a zero baseline.
  --open-weight      keep only models whose weights are published
  --models <list>    comma-separated modelShort values, in the order to color them
  --exclude <list>   comma-separated modelShort values to drop
  --no-title        omit the visible frame title
  --no-kicker       omit the trial-count line
  --no-panel-notes  omit the metric explanation lines
  --no-caveat       omit the left footer text
  --no-source       omit the source stamp; with --no-caveat the footer rule goes too
  --large-text      enlarge headings, labels, ticks and source credit
  --large-brand     double the logo and Gateway wordmark size
  --no-brand        omit the logo and Gateway wordmark
  --designer        dark background, metric colors and model logo tiles
  --brand-right     put the lockup top right, in line with the title
  --logo-spot <w>   with --designer: ${LOGO_SPOTS.join(' | ')} (default: ${LOGO_SPOTS[0]})
  --title <text>     frame title (default: derived from the selection)
  --kicker <text>    the mono line under the title
  --source <text>    the source stamp, bottom right
  --caveat <text>    the plain-text line, bottom left
  --out <dir>        default results/harbor/posters/<job>`)
  process.exit(has('help') ? 0 : 2)
}

const jsonPath = existsSync(input) ? input : join('results/harbor', `${input}.json`)
if (!existsSync(jsonPath)) {
  console.error(`no such job export: ${jsonPath}`)
  console.error('run `bun run report <job-dir>` first, or pass a path under results/harbor/.')
  process.exit(2)
}

const exp = JSON.parse(readFileSync(jsonPath, 'utf8')) as JobExport
if (!Array.isArray(exp.rows) || !exp.rows.length) {
  console.error(`${jsonPath} has no rows - is it a Heval job export?`)
  process.exit(1)
}

// -- select the models -------------------------------------------------------------

let rows = exp.rows
if (has('open-weight')) {
  const dropped = [...new Set(rows.filter((r) => !isOpenWeight(r)).map((r) => r.modelShort))]
  rows = rows.filter(isOpenWeight)
  if (dropped.length) console.log(`open-weight only: dropped ${dropped.join(', ')}`)
}
const excluded = (flag('exclude') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
if (excluded.length) rows = rows.filter((r) => !excluded.includes(r.modelShort))

const requested = (flag('models') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
if (requested.length) {
  const known = new Set(rows.map((r) => r.modelShort))
  const missing = requested.filter((m) => !known.has(m))
  if (missing.length) {
    console.error(`not in this job: ${missing.join(', ')}`)
    console.error(`available: ${[...known].sort().join(', ')}`)
    process.exit(2)
  }
  rows = rows.filter((r) => requested.includes(r.modelShort))
}
if (!rows.length) {
  console.error('every trial was filtered out - loosen --models / --exclude / --open-weight.')
  process.exit(1)
}

/**
 * Series order, which fixes the palette assignment for every panel.
 *
 * `--models` order when given, else alphabetical - anything stable and
 * independent of the values, so a model keeps its hue across panels and across
 * a rebuild after more trials land.
 */
const order = requested.length ? requested : [...new Set(rows.map((r) => r.modelShort))].sort()
if (order.length > POSTER_MAX_SERIES) {
  console.error(`${order.length} models, and the validated poster palette has ${POSTER_MAX_SERIES} slots.`)
  console.error('Cut the field with --models / --exclude and make a second poster; a generated 7th hue is not an option.')
  process.exit(2)
}

const panelIds = (flag('panels') ?? PANEL_IDS.join(',')).split(',').map((s) => s.trim()).filter(Boolean) as PanelId[]
const unknown = panelIds.filter((p) => !PANEL_IDS.includes(p))
if (unknown.length) {
  console.error(`unknown panel(s): ${unknown.join(', ')} - pick from ${PANEL_IDS.join(', ')}`)
  process.exit(2)
}

/**
 * Per-render axis ceilings, in the units the ticks print.
 *
 * `PANELS.completion` pins its ceiling to 1 so a pass rate is never read
 * against a data-fitted top. That is the right default and stays the default;
 * this flag is the deliberate opt-out for a frame whose tallest bar leaves a
 * third of the plot empty. Bars keep their zero baseline either way, so the
 * length ratio between two bars is unchanged - only the headroom moves.
 *
 * Two forms, because a combined frame needs a ceiling per panel and a single
 * panel does not:
 *
 *   --axis-max 80                     every rendered panel
 *   --axis-max completion=80          that panel only
 *   --axis-max completion=80,median-time=300
 *
 * Completion is stored as a 0-1 fraction but reads as a percentage, so a value
 * above 1 is taken as one: `completion=80` and `completion=0.8` both mean 80%.
 */
const axisMaxArg = flag('axis-max')
const axisMaxFor = new Map<PanelId, number>()
let axisMaxAll: number | null = null
if (axisMaxArg !== undefined) {
  for (const part of axisMaxArg.split(',').map((s) => s.trim()).filter(Boolean)) {
    const eq = part.indexOf('=')
    const name = eq >= 0 ? part.slice(0, eq).trim() : null
    const raw = eq >= 0 ? part.slice(eq + 1).trim() : part
    const value = Number(raw)
    if (!Number.isFinite(value) || value <= 0) {
      console.error(`--axis-max wants a positive number, got "${raw}" in "${part}"`)
      process.exit(2)
    }
    if (name === null) {
      axisMaxAll = value
      continue
    }
    if (!PANEL_IDS.includes(name as PanelId)) {
      console.error(`--axis-max: unknown panel "${name}" - pick from ${PANEL_IDS.join(', ')}`)
      process.exit(2)
    }
    axisMaxFor.set(name as PanelId, value)
  }
  const unused = [...axisMaxFor.keys()].filter((id) => !panelIds.includes(id))
  if (unused.length) console.warn(`! --axis-max names ${unused.join(', ')}, which this frame does not render`)
}

const built = panelIds.map((id) => {
  const panel = PANELS[id]
  const given = axisMaxFor.get(id) ?? axisMaxAll
  if (given === undefined || given === null) return buildPanel(rows, panel, order)
  const ceiling = id === 'completion' && given > 1 ? given / 100 : given
  const tallest = Math.max(0, ...order.map((k) => panel.value(rows.filter((r) => r.modelShort === k)) ?? 0))
  if (tallest > ceiling) {
    console.error(`--axis-max for ${id} is ${panel.tick(ceiling)}, below its tallest bar (${panel.tick(tallest)}) - it would clip.`)
    process.exit(2)
  }
  console.log(`${id}: axis ceiling ${panel.tick(ceiling)} (default ${panel.axisMax === null ? 'fitted' : panel.tick(panel.axisMax)})`)
  return buildPanel(rows, { ...panel, axisMax: ceiling }, order)
})
for (const d of built) {
  if (d.omitted.length) {
    console.warn(`! ${d.panel.id}: no value for ${d.omitted.join(', ')} - absent from the chart, not plotted as zero.`)
  }
}

// -- frame text -------------------------------------------------------------------

const tasks = new Set(rows.map((r) => r.task)).size
const harnesses = [...new Set(rows.map((r) => r.agent))]
const perCell = rows.length / (order.length * tasks)

const title = has('no-title') ? '' : flag('title') ?? `${order.length} models, compared`
const kicker = has('no-kicker') ? '' : flag('kicker') ?? `${rows.length} trials · ${tasks} tasks · ${harnesses.join(' + ')}`
const source = has('no-source') ? '' : flag('source') ?? `source: heval · ${exp.job}`
/**
 * The line the numbers cannot carry themselves.
 *
 * A poster is quoted without its caption, so the sample size travels inside the
 * image. At one trial per cell the intervals overlap across most of the field,
 * and a bar chart cannot say that - this line has to.
 */
const caveat =
  has('no-caveat') ? '' : flag('caveat') ??
  (perCell < 3
    ? `${perCell < 1.05 ? 'One attempt' : `${perCell.toFixed(1)} attempts`} per task per model. Treat small differences as directional`
    : `${perCell.toFixed(1)} attempts per task per model`)

// -- render ------------------------------------------------------------------------

const outDir = flag('out') ?? join('results/harbor/posters', exp.job)
mkdirSync(outDir, { recursive: true })

const singleSize = SIZES[(flag('size') as SizeName) ?? 'square'] ?? SIZES.square
const combinedSize = SIZES[(flag('size') as SizeName) ?? 'landscape'] ?? SIZES.landscape

const fonts = await inlineFonts()

const written: string[] = []

async function shoot(f: Frame, stem: string) {
  const html = await frameHtml(f, fonts)
  const htmlPath = join(outDir, `${stem}.html`)
  const pngPath = join(outDir, `${stem}.png`)
  writeFileSync(htmlPath, html)
  // Run Chromium automation in Node; Bun's Windows pipe transport can stall.
  const rendered = spawnSync('node', [fileURLToPath(new URL('render-poster.mjs', import.meta.url))], {
    input: JSON.stringify({ htmlPath, pngPath, width: f.size.w, height: f.size.h }),
    encoding: 'utf8',
    timeout: 60_000,
    windowsHide: true,
  })
  if (rendered.error || rendered.status !== 0) {
    throw new Error(rendered.error?.message ?? rendered.stderr ?? 'Poster rendering failed')
  }
  written.push(`${pngPath} (${f.size.w * 2}x${f.size.h * 2})`)
  written.push(htmlPath)
}

if (!has('only-combined')) {
  for (const d of built) {
    await shoot(
      { title: has('no-title') ? '' : flag('title') ?? d.panel.heading, kicker, source, caveat, panels: [d], size: singleSize },
      `${exp.job}-${d.panel.id}`,
    )
  }
}
if (has('combined') || has('only-combined')) {
  await shoot({ title, kicker, source, caveat, panels: built.map((p) => ({ ...p, bars: [...p.bars].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key)) })), size: combinedSize }, `${exp.job}-poster`)
}



console.log(`\n${order.length} models (${order.map((m) => labelLines(m).join(' ')).join(', ')})`)
console.log(`${nums(rows, 'costUsd').length}/${rows.length} trials priced\n`)
console.log(written.map((w) => `  ${w}`).join('\n'))
console.log(`\n${basename(jsonPath)} -> ${outDir}`)
