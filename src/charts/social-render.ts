import { labelLines, niceMax, POSTER_METRIC_SERIES, POSTER_LOGO_TILE } from './poster'
import { modelMark } from './model-marks'
import { PRESENTATION_DEFAULT_THEME } from './presentation-defaults'
import { SOCIAL_THEMES } from './social-themes'
const POSTER_INK = {
  primary: 'var(--primary)',
  secondary: 'var(--primary)',
  muted: 'var(--muted)',
  line: 'var(--line)',
}
const POSTER_SURFACE = 'var(--surface)'
import {
  SOCIAL_PRESETS,
  type SocialChart,
  type SocialSettings,
  type SocialBar,
} from './social-presets'
export const SOCIAL_RENDERER_VERSION = 'social-presets/4'
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
function metricColor(preset: SocialChart['preset']) {
  if (preset === 'cost-per-success' || preset === 'total-cost') return POSTER_METRIC_SERIES['cost-per-success']
  if (preset === 'median-time' || preset === 'slow-timeouts') return POSTER_METRIC_SERIES['median-time']
  return POSTER_METRIC_SERIES.completion
}
function logoTile(model: string, x: number, y: number) {
  const mark = modelMark(model)
  if (!mark) return ''
  const nested = mark.replace(/<svg\b([^>]*)>/, (_, attrs: string) => '<svg ' + attrs.replace(/\s(?:width|height|x|y)="[^"]*"/g, '') + ' x="' + (x + 5) + '" y="' + (y + 5) + '" width="30" height="30">')
  return '<g data-model-mark="' + esc(model) + '" color="' + POSTER_LOGO_TILE.ink + '">' + rect(x, y, 40, 40, POSTER_LOGO_TILE.bg) + nested + '</g>'
}
function vertical(
  bars: SocialBar[],
  x: number,
  y: number,
  w: number,
  h: number,
  max: number,
  unit: string,
  branded: boolean,
  color: string,
) {
  const gutter = 55,
    slot = (w - gutter) / bars.length
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
      bw = Math.min(110, slot * 0.55)
    svg +=
      rect(cx - bw / 2, y + h - bh, bw, bh, color) +
      text(
        cx,
        y + h - bh - (branded && modelMark(b.key) && bh < 65 ? 64 : 16),
        format(b.value, unit),
        30,
        'middle',
        POSTER_INK.primary,
        'data-max-width="' + (slot - 12) + '"',
      )
    if (branded) svg += logoTile(b.key, cx - 20, y + h - bh + (bh >= 65 ? 12 : -52))
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
/** SVG geometry is shared by browser preview and Chromium PNG export. */
export function socialSvg(
  chart: SocialChart,
  settings: SocialSettings,
  logo: string,
  page = 0,
): string {
  const theme = SOCIAL_THEMES[settings.theme ?? PRESENTATION_DEFAULT_THEME]
  const barColor = theme.brand ? metricColor(chart.preset) : theme.series[0]
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
      '<svg x="1160" y="60" width="205" height="43" fill="var(--primary)" viewBox="0 0 1800 371.7">' +
      logo.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '') +
      '</svg>' +
      text(1385, 93, 'Gateway', 30)
  svg += text(
    65,
    96,
    chart.title,
    46,
    'start',
    POSTER_INK.primary,
    'data-max-width="' + (theme.brand ? 1040 : 1470) + '" data-min-size="30" font-family="' +
      theme.display +
      '" font-weight="500" style="font-variant-numeric:normal;font-feature-settings: &quot;liga&quot; 0, &quot;calt&quot; 0"',
  )
  if (settings.showSubtitle)
    svg += text(
      65,
      164,
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
      164,
      SOCIAL_PRESETS[chart.preset].direction === 'higher' ? '↑ Higher is better' : '↓ Lower is better',
      21,
      'end',
      POSTER_INK.muted,
    )
  const layout = SOCIAL_PRESETS[chart.preset].layout
  svg += '<path d="M 65 205 H 1535" stroke="' + POSTER_INK.line + '"/>'
  if (layout === 'vertical' || layout === 'horizontal')
    svg += vertical(
      chart.bars,
      65,
      280,
      1470,
      425,
      chart.preset === 'completion' ? 1 : chart.preset === 'completed' ? chart.tasks : ceiling(Math.max(0, ...chart.bars.map(b => b.value ?? 0)), SOCIAL_PRESETS[chart.preset].unit),
      SOCIAL_PRESETS[chart.preset].unit,
      theme.brand,
      barColor,
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
      theme.brand,
      barColor,
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
      theme.brand,
      barColor,
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
