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

/**
 * Official weekly benchmark palette. Full opacity; lilac is reserved for the
 * best result in each metric. Dark canvas/type follow marketing SHARED.md.
 * Source: https://github.com/merge-api/merge-skills/tree/main/plugin/merge-marketing/skills/weekly-model-benchmark-graphic
 * Verified against SKILL.md, tokens.css and build.py on 2026-09-08.
 */
export const POSTER_WINNER = '#C6ADCA' // lilac-40
export const POSTER_COMPARISON_SERIES = [
  '#ABCAD8', // robin-40
  '#96A58D', // sage-40
  '#769399', // teal-40
  '#C3C5B3', // khaki-40
  '#ABAAA8', // charcoal-30
] as const

/** Hard cap. A seventh model folds into a second poster, never a generated hue. */
export const POSTER_MAX_SERIES = 6

/**
 * The canvas for the shipped Gateway look, darker than POSTER_SURFACE.
 *
 * POSTER_SURFACE is Merge Charcoal, which is the right card colour inside a
 * report that has a page around it. A poster has no page: the canvas runs to
 * the crop, and charcoal reads as a washed-out grey rectangle on a timeline
 * that is usually already dark. This drops to near-black so the ivory type and
 * the logo tiles carry the frame.
 */
export const POSTER_DESIGNER_SURFACE = '#12110F'

/**
 * The model logo tile - an ivory chip the provider mark sits in.
 *
 * Provider marks arrive in their own brand colours against assorted
 * backgrounds; several are near-black and vanish on this canvas. Rather than
 * recolouring someone else's mark, each one gets an ivory chip to sit on, which
 * is also what makes a bar identifiable without reading the axis label.
 */
export const POSTER_LOGO_TILE = {
  bg: '#F5F2EE',
  ink: '#181916',
  /** Hairline so the chip has an edge where it meets a light bar. */
  border: '#ffffff40',
} as const

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
  /**
   * Axis floor. Omitted means a zero baseline, which is the only honest one for
   * bars and stays the default everywhere. The social composition's editor
   * exposes it so a truncated axis is a deliberate, visible choice.
   */
  axisMin?: number
  /** One line under the heading, for the panels whose definition is not obvious. */
  note?: string
  /**
   * Interval between ticks, in the panel's own value units - 0.05 on a rate
   * axis draws one every 5%. Omitted lets the floor pick a count instead: five
   * levels against a zero baseline, four against a truncated one, the pair that
   * lands on round numbers. Only the social composition sets this, because only
   * its editor exposes the axis as a control.
   */
  tickStep?: number
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

/**
 * One hue per metric, replacing the winner-versus-comparison split.
 *
 * The winner/comparison scheme answers "who won this panel", which a reader can
 * already see from the bar heights. Posting the panels as a thread asks a
 * different question: which metric am I looking at. Colouring by metric rather
 * than by rank makes each image identifiable at thumbnail size and keeps a
 * model's colour from changing between panels, which previously implied a
 * ranking that moved when it had not.
 */
export const POSTER_METRIC_SERIES: Record<PanelId, string> = {
  completion: '#ABCAD8', // robin-40
  'cost-per-success': '#C6ADCA', // lilac-40
  'median-time': '#96A58D', // sage-40
}

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
    .replace(/\bsonnet\b/i, 'Sonnet')
    .replace(/\bpro\b/i, 'Pro')
    .replace(/\bmini\b/i, 'Mini')
    .replace(/\s+/g, ' ')
    .trim()
  const words = pretty.split(' ')
  if (words.length === 1) return words
  // Break after the maker so the family name owns the second line.
  return [words[0], words.slice(1).join(' ')]
}

/** Past this a step is drawing hairlines, not an axis. Guards a typed value. */
const TICK_LIMIT = 40

/**
 * Tick values from the floor up, one every `step`, stopping at the ceiling.
 *
 * A step that does not divide the span leaves the top tick short of the ceiling
 * rather than inventing a level above it - ticks every 25% under an 80% ceiling
 * reads 0/25/50/75, which is honest, where a sixth level at 100% would not be.
 * The epsilon is float defence: 0.8 / 0.05 is 15.999999999999998.
 */
function everyStep(min: number, span: number, step: number): number[] {
  const count = Math.min(TICK_LIMIT, Math.floor(span / step + 1e-9))
  return Array.from({ length: count + 1 }, (_, index) => min + index * step)
}

/**
 * Build one panel.
 *
 * `order` fixes which models enter the comparison. Each panel then ranks them
 * by its own metric without changing any values.
 */
export function buildPanel(rows: readonly TrialRow[], panel: Panel, order: readonly string[]): PanelData {
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
  const min = panel.axisMin ?? 0
  const span = max - min
  const bars: Bar[] = scored.map((s) => ({
    key: s.key,
    lines: labelLines(s.key),
    value: s.value,
    frac: span > 0 ? Math.min(1, Math.max(0, (s.value - min) / span)) : 0,
    n: s.n,
  }))
  // Four levels land on round numbers against a truncated floor; the five-level
  // ladder prints 43.75% against a 0.25 one. An explicit `tickStep` replaces
  // the ladder with a fixed interval, so a caller that offers the axis as a
  // control still gets this default when the control is left alone.
  const levels = min > 0 ? 4 : 5
  const ladder = Array.from({ length: levels }, (_, index) => index / (levels - 1))
  const ticks = panel.tickStep && panel.tickStep > 0 && span > 0
    ? everyStep(min, span, panel.tickStep).map((value) => ({ value, label: panel.tick(value), frac: (value - min) / span }))
    : ladder.map((f) => ({ value: min + span * f, label: panel.tick(min + span * f), frac: f }))
  return { panel, bars, ticks, omitted }
}
