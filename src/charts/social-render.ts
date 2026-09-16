import { labelLines, niceMax } from './poster'
import { SOCIAL_THEMES } from './social-themes'
const POSTER_INK = {
  primary: 'var(--primary)',
  secondary: 'var(--primary)',
  muted: 'var(--muted)',
  line: 'var(--line)',
}
const POSTER_SURFACE = 'var(--surface)'
const POSTER_WINNER = 'var(--winner)'
const POSTER_COMPARISON_SERIES = Array.from({ length: 5 }, (_, i) => 'var(--series-' + i + ')')
import {
  SOCIAL_PRESETS,
  type SocialChart,
  type SocialSettings,
  type SocialBar,
} from './social-presets'
export const SOCIAL_RENDERER_VERSION = 'social-presets/3'
const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
const text = (
  x: number,
  y: number,
  value: string,
  size = 24,
  anchor = 'start',
  fill: string = POSTER_INK.primary,
  extra = '',
) =>
  '<text x="' +
  x +
  '" y="' +
  y +
  '" font-size="' +
  size +
  '" text-anchor="' +
  anchor +
  '" fill="' +
  fill +
  '" ' +
  extra +
  '>' +
  esc(value) +
  '</text>'
const line = (x1: number, y1: number, x2: number, y2: number) =>
  '<path d="M ' +
  x1 +
  ' ' +
  y1 +
  ' L ' +
  x2 +
  ' ' +
  y2 +
  '" stroke="' +
  POSTER_INK.line +
  '" stroke-dasharray="5 7"/>'
const rect = (x: number, y: number, w: number, h: number, fill: string) =>
  '<rect x="' +
  x +
  '" y="' +
  y +
  '" width="' +
  Math.max(0, w) +
  '" height="' +
  Math.max(0, h) +
  '" fill="' +
  fill +
  '" rx="3"/>'
const name = (key: string) => labelLines(key).join(' ')
function format(value: number | null, unit: string) {
  if (value === null) return 'N/A'
  if (unit === 'usd')
    return '$' + (value === 0 ? '0' : value < 1 ? value.toPrecision(2) : value.toFixed(2))
  if (unit === 'seconds') return Math.round(value) + 's'
  if (unit === 'ratio') return Math.round(value * 100) + '%'
  return String(value)
}
function ceiling(max: number, unit: string) {
  return unit === 'count' ? Math.max(1, Math.ceil(max)) : niceMax(max)
}
function ticks(max: number, unit: string): number[] {
  if (unit === 'count') {
    const power = 10 ** Math.floor(Math.log10(Math.max(1, max / 4)))
    const step = Math.max(1, ([1, 2, 5, 10].find((v) => v * power >= max / 4) ?? 10) * power)
    return [
      ...new Set([
        0,
        ...Array.from({ length: Math.floor(max / step) }, (_, i) => (i + 1) * step),
        max,
      ]),
    ]
  }
  return [0, 0.25, 0.5, 0.75, 1].map((f) => f * max)
}
function colors(bars: SocialBar[], direction: string) {
  const vals = bars.flatMap((b) => (b.value === null ? [] : [b.value]))
  const best = direction === 'higher' ? Math.max(...vals) : Math.min(...vals)
  let i = 0
  return bars.map((b) =>
    b.value === null
      ? '#ABAAA8'
      : b.value === best
        ? POSTER_WINNER
        : POSTER_COMPARISON_SERIES[i++ % POSTER_COMPARISON_SERIES.length],
  )
}
function vertical(
  bars: SocialBar[],
  x: number,
  y: number,
  w: number,
  h: number,
  max: number,
  unit: string,
  direction: string,
) {
  const gutter = 55,
    slot = (w - gutter) / bars.length,
    palette = colors(bars, direction)
  let svg = ticks(max, unit)
    .map(
      (v) =>
        line(x + gutter, y + h - (v / max) * h, x + w, y + h - (v / max) * h) +
        text(
          x + gutter - 12,
          y + h - (v / max) * h + 6,
          format(v, unit),
          18,
          'end',
          POSTER_INK.muted,
        ),
    )
    .join('')
  bars.forEach((b, i) => {
    const cx = x + gutter + slot * (i + 0.5),
      bh = ((b.value ?? 0) / max) * h,
      bw = Math.min(80, slot * 0.43)
    svg +=
      rect(cx - bw / 2, y + h - bh, bw, bh, palette[i]) +
      text(
        cx,
        y + h - bh - 15,
        format(b.value, unit),
        26,
        'middle',
        POSTER_INK.primary,
        'data-max-width="' + (slot - 12) + '"',
      )
    labelLines(b.key).forEach((l, j) => {
      svg += text(
        cx,
        y + h + 36 + j * 25,
        l,
        20,
        'middle',
        POSTER_INK.secondary,
        'data-label="true" data-max-width="' + (slot - 12) + '"',
      )
    })
  })
  return svg
}
function horizontal(chart: SocialChart) {
  const unit = SOCIAL_PRESETS[chart.preset].unit,
    max = ceiling(Math.max(0, ...chart.bars.map((b) => b.value ?? 0)), unit)
  const x = 385,
    y = 230,
    w = 995,
    h = 480,
    slot = h / chart.bars.length,
    palette = colors(chart.bars, SOCIAL_PRESETS[chart.preset].direction)
  let svg = ticks(max, unit)
    .map(
      (v) =>
        line(x + (v / max) * w, y - 15, x + (v / max) * w, y + h) +
        text(x + (v / max) * w, y + h + 40, format(v, unit), 21, 'middle', POSTER_INK.muted),
    )
    .join('')
  chart.bars.forEach((b, i) => {
    const cy = y + slot * (i + 0.5),
      bw = ((b.value ?? 0) / max) * w
    svg +=
      text(
        65,
        cy + 9,
        name(b.key),
        25,
        'start',
        POSTER_INK.primary,
        'data-label="true" data-max-width="300"',
      ) +
      rect(x, cy - 25, bw, 50, palette[i]) +
      text(
        x + bw + 16,
        cy + 9,
        format(b.value, unit),
        27,
        'start',
        POSTER_INK.primary,
        'data-max-width="' + (1535 - x - bw - 16) + '"',
      )
  })
  return svg
}
/** SVG geometry is shared by browser preview and Chromium PNG export. */
export function socialSvg(
  chart: SocialChart,
  settings: SocialSettings,
  logo: string,
  page = 0,
): string {
  const theme = SOCIAL_THEMES[settings.theme ?? 'merge-dark']
  const variables = Object.entries({
    surface: theme.surface,
    primary: theme.primary,
    muted: theme.muted,
    line: theme.line,
    winner: theme.winner,
    pass: theme.pass,
    fail: theme.fail,
    cell: theme.cell,
    ...Object.fromEntries(theme.series.map((c, i) => ['series-' + i, c])),
  })
    .map(([k, v]) => '--' + k + ':' + v)
    .join(';')
  const matrixPages = Math.max(1, Math.ceil(chart.matrix.length / 12))
  let svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900" role="img" aria-label="' +
    esc(chart.title) +
    '" style="' +
    variables +
    ';font-family:Inter,system-ui,sans-serif;font-variant-numeric:tabular-nums">' +
    rect(0, 0, 1600, 900, POSTER_SURFACE)
  if (theme.brand)
    svg +=
      '<svg x="65" y="48" width="160" height="34" fill="var(--primary)" viewBox="0 0 1800 371.7">' +
      logo.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '') +
      '</svg>' +
      text(241, 75, 'Gateway', 26)
  svg += text(
    65,
    155,
    chart.title,
    43,
    'start',
    POSTER_INK.primary,
    'data-max-width="1470" data-min-size="32" font-family="' +
      theme.display +
      '" font-weight="500" style="font-variant-numeric:normal;font-feature-settings: &quot;liga&quot; 0, &quot;calt&quot; 0"',
  )
  if (settings.showSubtitle)
    svg += text(
      65,
      195,
      chart.preset === 'disagreement'
        ? chart.allPassed + ' passed by all; ' + chart.allFailed + ' failed by all'
        : chart.tasks + ' tasks per model',
      22,
      'start',
      POSTER_INK.muted,
    )
  if (settings.showDirection && chart.preset !== 'disagreement')
    svg += text(
      1535,
      195,
      SOCIAL_PRESETS[chart.preset].direction === 'higher' ? 'Higher is better' : 'Lower is better',
      21,
      'end',
      POSTER_INK.muted,
    )
  const layout = SOCIAL_PRESETS[chart.preset].layout
  if (layout === 'horizontal') svg += horizontal(chart)
  if (layout === 'vertical')
    svg += vertical(
      chart.bars,
      65,
      245,
      1470,
      450,
      chart.preset === 'completion' ? 1 : chart.tasks,
      SOCIAL_PRESETS[chart.preset].unit,
      'higher',
    )
  if (layout === 'paired') {
    svg += text(65, 247, 'Over 5 min, including timeouts', 25) + text(835, 247, 'Timeouts', 25)
    svg += vertical(
      chart.bars,
      65,
      300,
      700,
      390,
      ceiling(Math.max(...chart.bars.map((b) => b.value ?? 0)), 'count'),
      'count',
      'lower',
    )
    const timeout = chart.bars.map((b) => ({ ...b, value: b.timeout }))
    svg += vertical(
      timeout,
      835,
      300,
      700,
      390,
      ceiling(Math.max(...timeout.map((b) => b.value!)), 'count'),
      'count',
      'lower',
    )
  }
  if (layout === 'matrix') {
    const slice = chart.matrix.slice(page * 12, (page + 1) * 12),
      x = 470,
      w = 1065 / chart.bars.length,
      top = 270,
      rowH = 39
    chart.bars.forEach((b, i) =>
      labelLines(b.key).forEach((l, j) => {
        svg += text(
          x + w * (i + 0.5),
          222 + j * 24,
          l,
          20,
          'middle',
          POSTER_INK.primary,
          'data-label="true" data-max-width="' + (w - 12) + '"',
        )
      }),
    )
    slice.forEach((r, i) => {
      const label = r.task
      svg += text(
        x - 20,
        top + i * rowH + 25,
        label,
        20,
        'end',
        POSTER_INK.muted,
        'data-label="true" data-max-width="385"',
      )
      r.values.forEach((v, j) => {
        svg +=
          rect(
            x + j * w + 3,
            top + i * rowH,
            w - 6,
            rowH - 5,
            v === 1 ? 'var(--pass)' : 'var(--fail)',
          ) +
          text(
            x + w * (j + 0.5),
            top + i * rowH + 25,
            v === 1 ? 'Pass' : 'Fail',
            20,
            'middle',
            'var(--cell)',
          )
      })
    })
    if (!slice.length)
      svg += text(800, 480, 'All selected models have identical outcomes', 28, 'middle')
    svg += text(
      65,
      785,
      chart.allPassed +
        ' passed by all; ' +
        chart.allFailed +
        ' failed by all' +
        (matrixPages > 1 ? ' | Page ' + (page + 1) + ' of ' + matrixPages : ''),
      20,
      'start',
      POSTER_INK.muted,
    )
  }
  svg += '<path d="M 65 820 H 1535" stroke="' + POSTER_INK.line + '"/>'
  if (settings.showSource)
    svg += text(1535, 863, 'Source: ' + settings.source, 21, 'end', POSTER_INK.muted)
  return svg + '</svg>'
}
