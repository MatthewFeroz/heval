/**
 * Poster charts: a normalized job -> a single graph sized for a social post.
 *
 * The report and the studio render for a reader who can hover a mark, open a
 * table, and follow a footnote. A poster has none of that. It is a flat image
 * on someone else's timeline, read in about two seconds at whatever size the
 * platform decides, and often with the caption collapsed. That is a different
 * medium, not a different theme, which is why this file exists rather than a
 * fifth entry in THEMES: the type is three times larger, every bar is labelled
 * because there is no tooltip to fall back on, the axis is four ticks, and the
 * frame carries its own title and source stamp because the image travels alone.
 *
 * What it does NOT do is recompute anything. The panel statistics come from
 * src/charts/metrics.ts, the same module the static report derives its headline
 * numbers from, so a poster cannot quote a number the report disagrees with.
 *
 * Browser-safe: pure functions and data, no fs, no DOM.
 */

import { completionRate, costPerSuccess, medianTimePassed } from './metrics'
import type { TrialRow } from './trial'

// -- palette ----------------------------------------------------------------------

/** Merge marketing comparison-chart canvas. */
export const POSTER_SURFACE = '#2C2A25'

/**
 * The leading bar gets Merge Robin. Every comparison bar uses the same opaque
 * neutral, so the embossed background never shows through the data marks.
 */
export const POSTER_SERIES = ['#96BDCE', '#797771'] as const

/** Hard cap. A seventh model folds into a second poster, never a generated hue. */
export const POSTER_MAX_SERIES = 6

export const POSTER_INK = {
  /** Title, value labels. */
  primary: '#F5F2EE',
  /** Panel headings, axis category labels. */
  secondary: '#F5F2EE',
  /** Axis ticks, source stamp. */
  muted: '#D6CFC7',
  /** Baseline and the rule under a panel heading. */
  line: '#5A5751',
  /** Direction cue. Kept neutral so the chart has one accent only. */
  good: '#D6CFC7',
} as const

// -- panels ---------------------------------------------------------------------

export type PanelId = 'completion' | 'cost-per-success' | 'median-time'

export type Panel = {
  id: PanelId
  /** Panel heading, in the reference's title case. */
  heading: string
  /** Which direction is good. Drives the eyebrow and the sort. */
  better: 'higher' | 'lower'
  /** The group statistic. Null means "cannot be computed", never zero. */
  value: (group: TrialRow[]) => number | null
  /** The label above a bar. */
  format: (v: number) => string
  /** An axis tick. Coarser than the bar label on purpose. */
  tick: (v: number) => string
  /** Axis ceiling. `null` lets the data pick it. */
  axisMax: number | null
  /** One line under the heading, for the panels whose definition is not obvious. */
  note?: string
}

export const PANELS: Record<PanelId, Panel> = {
  completion: {
    id: 'completion',
    heading: 'Completion rate',
    better: 'higher',
    value: completionRate,
    format: (v) => `${Math.round(v * 100)}%`,
    tick: (v) => `${Math.round(v * 100)}%`,
    // Pinned to 1: a pass rate read against a data-fitted ceiling invites the
    // reader to mistake the tallest bar for a solved benchmark.
    axisMax: 1,
  },
  'cost-per-success': {
    id: 'cost-per-success',
    heading: 'Cost per success',
    better: 'lower',
    value: costPerSuccess,
    // Two significant figures, not a fixed decimal count. This axis spans three
    // orders of magnitude across a model sweep: `$.2f` prints every sub-cent
    // model as `$0.00` and erases the cheap end, which is the end the
    // comparison is about, while a fixed four decimals gives the expensive end
    // digits nobody reads.
    format: (v) => `$${sigFigs(v, 2)}`,
    tick: (v) => (v === 0 ? '$0' : v >= 1 ? `$${v.toFixed(0)}` : `$${v.toFixed(2)}`),
    axisMax: null,
    note: 'total spend / passes',
  },
  'median-time': {
    id: 'median-time',
    heading: 'Median time',
    better: 'lower',
    value: medianTimePassed,
    format: (v) => `${Math.round(v)}s`,
    tick: (v) => `${Math.round(v)}s`,
    axisMax: null,
    note: 'passed trials only',
  },
}

export const PANEL_IDS = Object.keys(PANELS) as PanelId[]

/** `0.008716` -> `0.0087`, `0.3172` -> `0.32`, `12.4` -> `12`. Trailing zeros dropped. */
export function sigFigs(v: number, digits: number): string {
  if (v === 0) return '0'
  const places = Math.max(0, digits - 1 - Math.floor(Math.log10(Math.abs(v))))
  return v.toFixed(places).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
}

// -- bars -----------------------------------------------------------------------

export type Bar = {
  /** Series key - the model, as it appears in the data. */
  key: string
  /** Axis label, already broken into the lines the poster will stack. */
  lines: string[]
  value: number
  /** Bar height as a fraction of the plot, 0..1. */
  frac: number
  /** Trials behind the number, for the caption the poster cannot carry. */
  n: number
}

export type PanelData = {
  panel: Panel
  bars: Bar[]
  ticks: { value: number; label: string; frac: number }[]
  /** Series with no computable value, named so the omission is stated. */
  omitted: string[]
}

/**
 * A nice axis ceiling at or above `max`.
 *
 * Finer steps than the usual 1/2/5 ladder, because a poster is mostly plot: a
 * $0.77 tallest bar under a $1 ceiling gives away a quarter of the panel to
 * empty space, where $0.80 does not. Every step still divides into four whole
 * ticks, so the panels of one poster share a rhythm even though their units do
 * not, and the tick labels stay short enough to read at thumbnail size.
 */
export function niceMax(max: number): number {
  if (!(max > 0)) return 1
  const pow = 10 ** Math.floor(Math.log10(max))
  for (const step of [1, 1.2, 1.6, 2, 2.4, 3, 4, 5, 6, 8, 10]) {
    if (max <= step * pow) return step * pow
  }
  return 10 * pow
}

/** `deepseek-v4-pro-0813` -> ['DeepSeek', 'V4 Pro'] - two lines, no third. */
export function labelLines(modelShort: string): string[] {
  const pretty = modelShort
    .replace(/^glm-/, 'GLM ')
    .replace(/^deepseek-/, 'DeepSeek ')
    .replace(/^kimi-/, 'Kimi ')
    .replace(/^claude-/, 'Claude ')
    .replace(/^gpt-/, 'GPT ')
    .replace(/^qwen-?/, 'Qwen ')
    .replace(/^llama-?/, 'Llama ')
    // Trailing build stamps are provenance, not identity, and the poster names
    // the exact slug in its source stamp instead.
    .replace(/-\d{4}$/, '')
    .replace(/-(\d+)-(\d+)$/, ' $1.$2')
    .replace(/-/g, ' ')
    .replace(/\bv(\d)/gi, 'V$1')
    .replace(/\bk(\d)/gi, 'K$1')
    .replace(/\bflash\b/i, 'Flash')
    .replace(/\bpro\b/i, 'Pro')
    .replace(/\bmini\b/i, 'Mini')
    .replace(/\s+/g, ' ')
    .trim()
  const words = pretty.split(' ')
  if (words.length === 1) return words
  // Break after the maker so the family name owns the second line.
  return [words[0], words.slice(1).join(' ')]
}

/**
 * Build one panel.
 *
 * `order` fixes which models enter the comparison. Each panel then ranks them
 * by its own metric without changing any values.
 */
export function buildPanel(rows: TrialRow[], panel: Panel, order: readonly string[]): PanelData {
  const scored: { key: string; value: number; n: number }[] = []
  const omitted: string[] = []
  for (const key of order) {
    const group = rows.filter((r) => r.modelShort === key)
    const v = group.length ? panel.value(group) : null
    if (v === null) {
      omitted.push(key)
      continue
    }
    scored.push({ key, value: v, n: group.length })
  }
  // Best first, left to right - the reference's reading order, and the one a
  // skimmer assumes. `better` decides which end that is.
  scored.sort((a, b) => (panel.better === 'higher' ? b.value - a.value : a.value - b.value))

  const max = panel.axisMax ?? niceMax(Math.max(...scored.map((s) => s.value), 0))
  const bars: Bar[] = scored.map((s) => ({
    key: s.key,
    lines: labelLines(s.key),
    value: s.value,
    frac: max > 0 ? s.value / max : 0,
    n: s.n,
  }))
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({ value: max * f, label: panel.tick(max * f), frac: f }))
  return { panel, bars, ticks, omitted }
}
