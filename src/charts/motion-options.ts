/**
 * The knobs the Studio's Motion editor exposes, in a module with no Node
 * imports so the browser bundle and the server share one definition. The
 * sliders read their bounds from here and the server clamps to the same ones,
 * so a hand-typed URL cannot produce a composition the editor could not.
 */

import { DEFAULT_THEME, themeId, type ThemeId } from './motion-themes'

export type CanvasId = 'landscape' | 'square' | 'portrait'

export type MotionCanvas = {
  /** Shown in the editor's picker. Shape and pixels, not a platform. */
  label: string
  width: number
  height: number
}

/**
 * Export sizes the composition can draw. The layout is flex, so the plot
 * fills whatever remains after padding; these only change the frame.
 */
export const MOTION_CANVASES: Record<CanvasId, MotionCanvas> = {
  landscape: { label: '16:9 · 1600×900', width: 1600, height: 900 },
  square: { label: '1:1 · 1200×1200', width: 1200, height: 1200 },
  portrait: { label: '9:16 · 1080×1920', width: 1080, height: 1920 },
}

export const CANVAS_IDS = Object.keys(MOTION_CANVASES) as CanvasId[]
export const DEFAULT_CANVAS: CanvasId = 'landscape'

export function canvasId(value: unknown): CanvasId {
  return typeof value === 'string' && value in MOTION_CANVASES ? (value as CanvasId) : DEFAULT_CANVAS
}

export function motionCanvas(value: unknown): MotionCanvas {
  return MOTION_CANVASES[canvasId(value)]
}

export type CompletionOptions = {
  /** Axis ceiling as a rate, 0..1. Lower it to spend less of the frame on sky. */
  axisMax: number
  /** Axis floor as a rate. Above 0 truncates the baseline. */
  axisMin: number
  /**
   * Interval between axis ticks as a rate: 0.05 draws one every 5%. 0 keeps the
   * ladder the floor picks. Labels always; rules only with `gridLines`.
   */
  tickStep: number
  /** Tick-label nudge, percent of the label's own height. 0 sits on the gridline. */
  tickOffset: number
  /**
   * Multiplier on type and header spacing. Outer canvas padding stays fixed;
   * the plot fills the space left by the text.
   */
  typeScale: number
  /**
   * Padding above the lockup, in px. The side and bottom padding are fixed, so
   * this is the one frame edge that moves: lower it to lift the whole header
   * and hand the extra height to the plot. Unlike the header's internal gaps
   * this does not scale with `typeScale` - it is a frame margin, not type.
   */
  topPad: number
  /** Runtime in seconds. The whole timeline stretches to fit it. */
  duration: number
  /** Empty keeps the composition's built-in title. */
  title: string
  /** Line under the title. Empty keeps the built-in. */
  kicker: string
  /** Line above the plot. Empty keeps the built-in. */
  cue: string
  /** Footer, left. Empty keeps the built-in. */
  note: string
  /** Footer, right. Empty keeps the built-in. */
  source: string
  /** Text beside the lockup. Empty keeps the theme's own wordmark. */
  wordmark: string
  /**
   * Per-bar label overrides, keyed by the model the bar draws. A missing or
   * empty entry keeps the name derived from the model slug. Keys that match no
   * drawn bar are ignored, so a stale override cannot invent a series.
   */
  barLabels: Record<string, string>
  /**
   * Axis tick label overrides, keyed by the tick's value (see `tickKey`). The
   * tick still sits where the scale puts it; only its text changes.
   */
  tickLabels: Record<string, string>
  /**
   * Bar value label overrides, keyed by the model the bar draws.
   *
   * These print over a number the data produced, so an overridden label is
   * drawn as fixed text and skips the count-up: a counter that lands on
   * something other than what it counted to would be a worse lie than a
   * caption. The bar's height is unaffected - it still comes from the data.
   */
  valueLabels: Record<string, string>
  /** Palette, fonts, and branding. See motion-themes.ts. */
  theme: ThemeId
  /** Frame size. See MOTION_CANVASES. */
  canvas: CanvasId
  /**
   * The 1px rule above the plot. Off removes it. The baseline and the footer
   * rule stay. Independent of whatever cue sits above the plot.
   */
  plotRule: boolean
  /** Show the direction cue, such as "Higher is better", above the plot. */
  showCue: boolean
  /**
   * A 1px rule across the plot at every axis tick. Off draws the tick labels
   * alone, which is how the published poster reads, so this stays off by
   * default rather than restyling existing artwork.
   */
  gridLines: boolean
}

/** The options a range input can drive. `title` is text and handled apart. */
export type NumericOption = 'axisMax' | 'axisMin' | 'tickOffset' | 'typeScale' | 'topPad' | 'duration'

export const COMPLETION_DEFAULTS: CompletionOptions = {
  axisMax: 0.8,
  axisMin: 0,
  tickStep: 0,
  tickOffset: -28,
  typeScale: 1,
  topPad: 67.5,
  duration: 8,
  title: '',
  kicker: '',
  cue: '',
  note: '',
  source: '',
  wordmark: '',
  barLabels: {},
  tickLabels: {},
  valueLabels: {},
  theme: DEFAULT_THEME,
  canvas: DEFAULT_CANVAS,
  plotRule: false,
  showCue: true,
  gridLines: false,
}

/**
 * Editable copy. Labels name the slot, never one chart's current sentence.
 *
 * In frame order, top to bottom, so the panel reads down the artwork. The hints
 * do not repeat "blank keeps the built-in": the editor shows the built-in
 * itself as the placeholder, which says it better than a sentence can.
 */
export type TextOption = 'wordmark' | 'title' | 'kicker' | 'cue' | 'note' | 'source'

export const COMPLETION_TEXT: Record<TextOption, { label: string; hint: string; max: number; wide?: boolean }> = {
  wordmark: { label: 'Wordmark', hint: 'beside the lockup', max: 32 },
  title: { label: 'Title', hint: 'the headline', max: 72 },
  kicker: { label: 'Kicker', hint: 'line under the title', max: 96, wide: true },
  cue: { label: 'Cue', hint: 'line above the plot', max: 48 },
  note: { label: 'Footer left', hint: 'the caveat', max: 140, wide: true },
  source: { label: 'Footer right', hint: 'the source stamp', max: 80, wide: true },
}

export const TEXT_OPTIONS = Object.keys(COMPLETION_TEXT) as TextOption[]

/** A bar label is two short lines at most; past this it wraps into the plot. */
export const COMPLETION_BAR_LABEL_MAX = 40

/** Axis ticks and value labels sit in narrow gutters; keep them short. */
export const COMPLETION_SHORT_LABEL_MAX = 16

/**
 * The three per-element override maps, and the query-string prefix each one
 * travels under. One param per override rather than a JSON blob: the player's
 * `src` stays readable, and a hand-trimmed URL degrades to fewer overrides
 * instead of none.
 */
export const OVERRIDE_MAPS = {
  barLabels: { param: 'label.', max: COMPLETION_BAR_LABEL_MAX },
  tickLabels: { param: 'tick.', max: COMPLETION_SHORT_LABEL_MAX },
  valueLabels: { param: 'value.', max: COMPLETION_SHORT_LABEL_MAX },
} as const

export type OverrideMap = keyof typeof OVERRIDE_MAPS

export const OVERRIDE_KEYS = Object.keys(OVERRIDE_MAPS) as OverrideMap[]

/** @deprecated Read `OVERRIDE_MAPS.barLabels.param`. Kept for older links. */
export const BAR_LABEL_PARAM = OVERRIDE_MAPS.barLabels.param

/** On/off knobs. Labels stay about the drawing, never about one chart's copy. */
export type FlagOption = 'plotRule' | 'gridLines' | 'showCue'

export const COMPLETION_FLAGS: Record<FlagOption, { label: string; hint: string }> = {
  showCue: { label: 'Direction label', hint: 'show “Higher is better” above the graph' },
  plotRule: { label: 'Plot rule', hint: '1px line above the plot' },
  gridLines: { label: 'Gridlines', hint: 'a rule across the plot at each tick' },
}

export const FLAG_OPTIONS = Object.keys(COMPLETION_FLAGS) as FlagOption[]

/**
 * Selectable tick intervals, as a closed list rather than a slider. An axis
 * wants round numbers - a 7% step prints labels nobody reads - and a fixed list
 * doubles as the allow-list for a query string. `0` means the built-in ladder.
 */
export const COMPLETION_TICK_STEPS: { value: number; label: string }[] = [
  { value: 0, label: 'Auto' },
  { value: 0.05, label: 'Every 5%' },
  { value: 0.1, label: 'Every 10%' },
  { value: 0.2, label: 'Every 20%' },
  { value: 0.25, label: 'Every 25%' },
]

/** Anything not on the list falls back to the ladder rather than guessing. */
export function tickStepRate(value: unknown): number {
  const rate = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return COMPLETION_TICK_STEPS.some((step) => step.value === rate) ? rate : 0
}

export const COMPLETION_CONTROLS: Record<NumericOption, { min: number; max: number; step: number }> = {
  axisMax: { min: 0.2, max: 1, step: 0.05 },
  axisMin: { min: 0, max: 0.5, step: 0.05 },
  tickOffset: { min: -60, max: 0, step: 2 },
  // 1.35 renders clean even with a full-length two-line title; the cap is here
  // because padding does not scale, so the plot keeps shrinking past it.
  typeScale: { min: 0.85, max: 1.35, step: 0.05 },
  // Steps of 1.5 keep the 0.75 reduction the rest of the composition is drawn
  // at, so the default lands on the grid rather than between two stops.
  topPad: { min: 22.5, max: 90, step: 1.5 },
  duration: { min: 4, max: 12, step: 0.5 },
}

/** A headline longer than this wraps past two lines and pushes the plot down. */
export const COMPLETION_TITLE_MAX = COMPLETION_TEXT.title.max

export const NUMERIC_OPTIONS = Object.keys(COMPLETION_CONTROLS) as NumericOption[]

/** Collapse whitespace so a pasted newline cannot break out of a text slot. */
function collapse(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''
}

/**
 * Overrides arrive two ways: nested under their map name from the exporter's
 * JSON body, and flattened as `<prefix><key>` params from the player's query
 * string. Accept both, drop the empties, and keep the key verbatim - a key is
 * only ever matched against something the panel drew, never rendered, so one
 * that matches nothing is inert rather than dangerous.
 */
function overrides(raw: Record<string, unknown> | null | undefined, map: OverrideMap): Record<string, string> {
  const { param, max } = OVERRIDE_MAPS[map]
  const out: Record<string, string> = {}
  const nested = raw?.[map]
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    for (const [key, value] of Object.entries(nested as Record<string, unknown>)) {
      const label = collapse(value, max)
      if (key && label) out[key] = label
    }
  }
  for (const [name, value] of Object.entries(raw ?? {})) {
    if (!name.startsWith(param)) continue
    const key = name.slice(param.length)
    const label = collapse(value, max)
    if (key && label) out[key] = label
  }
  return out
}

function flag(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const token = value.trim().toLowerCase()
    if (token === 'false' || token === '0' || token === 'off') return false
    if (token === 'true' || token === '1' || token === 'on') return true
  }
  return fallback
}

/** Coerce untrusted query-string or request-body values into safe options. */
export function completionOptions(raw: Record<string, unknown> | null | undefined): CompletionOptions {
  const bound = (key: NumericOption) => {
    const value = raw?.[key]
    // A blank param is an absent one, not a zero: `?topPad=` should fall back
    // to the default rather than clamp to the bottom of the range.
    const text = typeof value === 'string' ? value.trim() : ''
    const n = typeof value === 'number' ? value : text ? Number(text) : NaN
    const { min, max } = COMPLETION_CONTROLS[key]
    return Math.min(max, Math.max(min, Number.isFinite(n) ? n : COMPLETION_DEFAULTS[key]))
  }
  const line = (key: TextOption) => {
    const value = raw?.[key]
    if (typeof value !== 'string') return COMPLETION_DEFAULTS[key]
    return collapse(value, COMPLETION_TEXT[key].max)
  }
  const axisMax = bound('axisMax')
  return {
    axisMax,
    // A floor at or above the ceiling leaves no scale to draw on.
    axisMin: Math.min(bound('axisMin'), axisMax - COMPLETION_CONTROLS.axisMax.step),
    tickStep: tickStepRate(raw?.tickStep),
    tickOffset: bound('tickOffset'),
    typeScale: bound('typeScale'),
    topPad: bound('topPad'),
    duration: bound('duration'),
    title: line('title'),
    kicker: line('kicker'),
    cue: line('cue'),
    note: line('note'),
    source: line('source'),
    wordmark: line('wordmark'),
    barLabels: overrides(raw, 'barLabels'),
    tickLabels: overrides(raw, 'tickLabels'),
    valueLabels: overrides(raw, 'valueLabels'),
    theme: themeId(raw?.theme),
    canvas: canvasId(raw?.canvas),
    plotRule: flag(raw?.plotRule ?? raw?.headingRule, COMPLETION_DEFAULTS.plotRule),
    showCue: flag(raw?.showCue, COMPLETION_DEFAULTS.showCue),
    gridLines: flag(raw?.gridLines, COMPLETION_DEFAULTS.gridLines),
  }
}

/**
 * When the still frames are grabbed. The animation has to have settled, so this
 * tracks `duration` rather than sitting at a fixed 7.9s.
 */
export function completionTiming(options: CompletionOptions): { duration: number; finalFrameAt: number } {
  return { duration: options.duration, finalFrameAt: Math.max(0, options.duration - 0.1) }
}

/** Only the values that differ from the defaults, for a short player URL. */
export function completionQuery(options: CompletionOptions): string {
  const params = new URLSearchParams()
  for (const key of Object.keys(COMPLETION_DEFAULTS) as (keyof CompletionOptions)[]) {
    // The override maps are records; String() on one sends "[object Object]".
    if ((OVERRIDE_KEYS as string[]).includes(key)) continue
    if (options[key] !== COMPLETION_DEFAULTS[key]) params.set(key, String(options[key]))
  }
  for (const map of OVERRIDE_KEYS) {
    for (const [key, label] of Object.entries(options[map] ?? {})) {
      if (label) params.set(`${OVERRIDE_MAPS[map].param}${key}`, label)
    }
  }
  return params.toString()
}

/**
 * Whether two option sets would draw the same frame.
 *
 * The override maps make an identity check useless - every coercion and every
 * keystroke rebuilds the record - so the editor's "modified" state and the
 * player's remount key both need a structural comparison.
 */
export function sameCompletionOptions(a: CompletionOptions, b: CompletionOptions): boolean {
  for (const key of Object.keys(COMPLETION_DEFAULTS) as (keyof CompletionOptions)[]) {
    if ((OVERRIDE_KEYS as string[]).includes(key)) continue
    if (a[key] !== b[key]) return false
  }
  return OVERRIDE_KEYS.every((map) => {
    const left = Object.entries(a[map] ?? {}).filter(([, label]) => label).sort()
    const right = Object.entries(b[map] ?? {}).filter(([, label]) => label).sort()
    return left.length === right.length
      && left.every(([key, label], index) => right[index][0] === key && right[index][1] === label)
  })
}
