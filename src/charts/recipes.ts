/**
 * Chart recipes: normalized trial rows + editor state -> Vega-Lite spec.
 *
 * This module is the one place a Heval chart is defined. The graph editor
 * renders the spec in the browser; `harbor/report/build-report.ts` compiles the
 * same spec to SVG headlessly for the static report. Editing a control in the
 * studio and re-running the report therefore produce the same picture.
 *
 * Browser-safe: no fs, no DOM. Pure functions of (rows, state).
 *
 * Form follows the dataviz method: the recipe is chosen by the data's job
 * (magnitude -> bar, trade-off -> scatter, spread -> strip, grid of magnitudes
 * -> matrix), color is assigned last from the validated palette and refused
 * past four values, marks are thin with rounded data-ends and a surface gap,
 * every mark has a tooltip, and a table of the plotted numbers is always
 * returned alongside the spec so identity never rides on color alone.
 */

import type { TopLevelSpec } from 'vega-lite'
import { MAX_SERIES, THEMES, type Theme, type ThemeMode } from './palette'
import {
  DIMENSION_LABEL,
  MEASURE_FORMAT,
  MEASURE_LABEL,
  type Dimension,
  type Measure,
  type TrialRow,
} from './trial'

export type Recipe = 'bar' | 'scatter' | 'strip' | 'matrix'
export type Aggregate = 'mean' | 'median' | 'sum' | 'min' | 'max'
export type SortOrder = 'alpha' | 'desc' | 'asc'

export type ChartState = {
  recipe: Recipe
  /** Grouping dimension: bar x, scatter point identity, strip rows, matrix columns. */
  x: Dimension
  /** Series dimension. Encoded as color; `none` for a single series. */
  color: Dimension | 'none'
  /** Small-multiples dimension (bar and strip). */
  facet: Dimension | 'none'
  /** Matrix rows. */
  row: Dimension
  /** The plotted measure (bar y, scatter y, strip x, matrix cell). */
  measure: Measure
  /** Scatter x - the cost side of the trade-off. */
  xMeasure: Measure
  aggregate: Aggregate
  sort: SortOrder
  /** Direct value labels on marks. */
  labels: boolean
  /** Wilson 95% intervals on pass rates (bar only). */
  intervals: boolean
  theme: ThemeMode
  title: string
  subtitle: string
  /**
   * d3-format override for the plotted measure, empty to use MEASURE_FORMAT.
   *
   * Needed because one format cannot serve one measure at every magnitude. Cost
   * per completed task is the case in hand: it spans three orders of magnitude
   * across a model sweep, and the shared `$.2f` renders every sub-cent model as
   * `$0.00` - erasing the cheap end, which is the end the comparison is about.
   */
  format: string
}

export const RECIPE_LABEL: Record<Recipe, string> = {
  bar: 'Pass rate / magnitude by group',
  scatter: 'Quality versus cost',
  strip: 'Distribution per trial',
  matrix: 'Per-task matrix',
}

export const DEFAULT_STATE: ChartState = {
  recipe: 'bar',
  x: 'agent',
  color: 'modelShort',
  facet: 'none',
  row: 'task',
  measure: 'passed',
  xMeasure: 'costUsd',
  aggregate: 'mean',
  sort: 'alpha',
  labels: true,
  intervals: true,
  // Dark is the product surface; light is the paper export.
  theme: 'dark',
  title: '',
  subtitle: '',
  format: '',
}

/** Recipe presets - the starting point when the user switches form. */
export const RECIPE_DEFAULTS: Record<Recipe, Partial<ChartState>> = {
  bar: { x: 'agent', color: 'modelShort', facet: 'none', measure: 'passed', aggregate: 'mean', labels: true },
  scatter: { x: 'agent', color: 'modelShort', measure: 'passed', xMeasure: 'costUsd', aggregate: 'mean', labels: true },
  strip: { x: 'stack', color: 'modelShort', facet: 'none', measure: 'agentSeconds', labels: false },
  matrix: { x: 'stack', row: 'task', measure: 'passed', aggregate: 'mean', labels: true },
}

export type AggRow = {
  /** Values of the grouping dimensions, keyed by dimension name. */
  [dim: string]: string | number | boolean | null | undefined
  value: number | null
  /** Second measure for scatter. */
  xValue?: number | null
  n: number
  /** Trials excluded because the measure was null (e.g. cost not exposed). */
  missing: number
  lo?: number
  hi?: number
  frontier?: boolean
}

export type ChartOutput = {
  spec: TopLevelSpec
  /** The numbers actually plotted, for the table view. */
  table: AggRow[]
  /** Column order for the table view. */
  columns: string[]
  warnings: string[]
  theme: Theme
}

// -- aggregation ---------------------------------------------------------------

const dimValue = (row: TrialRow, dim: Dimension): string => {
  const v = row[dim]
  return v === null || v === undefined ? '(none)' : String(v)
}

function agg(values: number[], how: Aggregate): number | null {
  if (!values.length) return null
  switch (how) {
    case 'mean':
      return values.reduce((a, b) => a + b, 0) / values.length
    case 'sum':
      return values.reduce((a, b) => a + b, 0)
    case 'min':
      return Math.min(...values)
    case 'max':
      return Math.max(...values)
    case 'median': {
      const s = [...values].sort((a, b) => a - b)
      const mid = Math.floor(s.length / 2)
      return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
    }
  }
}

/** Wilson score interval, 95%. Correct for small n where the normal approximation lies. */
export function wilson(passes: number, n: number): [number, number] {
  if (n === 0) return [0, 0]
  const z = 1.96
  const p = passes / n
  const denom = 1 + (z * z) / n
  const centre = p + (z * z) / (2 * n)
  const half = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))
  return [Math.max(0, (centre - half) / denom), Math.min(1, (centre + half) / denom)]
}

export function aggregate(
  rows: TrialRow[],
  dims: Dimension[],
  measure: Measure,
  how: Aggregate,
  xMeasure?: Measure,
): AggRow[] {
  const groups = new Map<string, { keys: Record<string, string>; rows: TrialRow[] }>()
  for (const r of rows) {
    const keys: Record<string, string> = {}
    for (const d of dims) keys[d] = dimValue(r, d)
    const k = dims.map((d) => keys[d]).join('\u0000')
    const g = groups.get(k) ?? { keys, rows: [] }
    g.rows.push(r)
    groups.set(k, g)
  }
  const out: AggRow[] = []
  for (const g of groups.values()) {
    const vals = g.rows.map((r) => r[measure]).filter((v): v is number => typeof v === 'number')
    const row: AggRow = { ...g.keys, value: agg(vals, how), n: g.rows.length, missing: g.rows.length - vals.length }
    if (xMeasure) {
      const xs = g.rows.map((r) => r[xMeasure]).filter((v): v is number => typeof v === 'number')
      row.xValue = agg(xs, how)
      row.missing = Math.max(row.missing, g.rows.length - xs.length)
    }
    if (measure === 'passed' && how === 'mean') {
      const [lo, hi] = wilson(vals.reduce((a, b) => a + b, 0), vals.length)
      row.lo = lo
      row.hi = hi
    }
    out.push(row)
  }
  return out
}

/** Points no other point beats on both axes (lower x, higher y). */
function markFrontier(points: AggRow[]): void {
  const usable = points.filter((p) => typeof p.xValue === 'number' && typeof p.value === 'number')
  usable.sort((a, b) => (a.xValue as number) - (b.xValue as number) || (b.value as number) - (a.value as number))
  let best = -Infinity
  for (const p of usable) {
    const v = p.value as number
    p.frontier = v > best
    if (v > best) best = v
  }
}

function domainOf(rows: TrialRow[], dim: Dimension): string[] {
  return [...new Set(rows.map((r) => dimValue(r, dim)))].sort()
}

function sortedDomain(table: AggRow[], dim: Dimension, sort: SortOrder): string[] | undefined {
  const alpha = [...new Set(table.map((r) => String(r[dim])))].sort()
  if (sort === 'alpha') return alpha
  const totals = new Map<string, number[]>()
  for (const r of table) {
    if (typeof r.value !== 'number') continue
    const k = String(r[dim])
    totals.set(k, [...(totals.get(k) ?? []), r.value])
  }
  const mean = (k: string) => {
    const v = totals.get(k) ?? []
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : -Infinity
  }
  return alpha.sort((a, b) => (sort === 'desc' ? mean(b) - mean(a) : mean(a) - mean(b)))
}

// -- theme -> vega-lite config ---------------------------------------------------

export function vegaConfig(theme: Theme): Record<string, unknown> {
  return {
    background: 'transparent',
    font: theme.font,
    padding: 8,
    view: { stroke: null },
    axis: {
      labelColor: theme.inkMuted,
      titleColor: theme.inkMuted,
      labelFont: theme.font,
      titleFont: theme.font,
      labelFontSize: 11,
      titleFontSize: 11,
      titleFontWeight: 500,
      gridColor: theme.grid,
      gridWidth: 1,
      domainColor: theme.grid,
      ticks: false,
      labelPadding: 6,
      titlePadding: 10,
    },
    axisX: { grid: false, labelAngle: 0 },
    axisY: { domain: false },
    legend: {
      orient: 'top',
      direction: 'horizontal',
      labelColor: theme.ink,
      titleColor: theme.inkMuted,
      labelFont: theme.font,
      titleFont: theme.font,
      labelFontSize: 12,
      titleFontSize: 11,
      titleFontWeight: 500,
      symbolType: 'square',
      symbolSize: 80,
      labelLimit: 260,
      // Vega's text estimator under-measures Inter, so horizontal legend
      // entries collide in a real browser even though the headless SVG looks
      // fine. Pad the gap explicitly rather than trusting the measurement.
      columnPadding: 20,
      labelOffset: 6,
      titlePadding: 6,
      offset: 8,
    },
    header: {
      labelColor: theme.ink,
      titleColor: theme.inkMuted,
      labelFont: theme.font,
      titleFont: theme.font,
      labelFontSize: 12,
      labelFontWeight: 500,
      titleFontSize: 11,
    },
    title: {
      color: theme.ink,
      subtitleColor: theme.inkMuted,
      font: theme.font,
      subtitleFont: theme.font,
      fontSize: 16,
      fontWeight: 600,
      subtitleFontSize: 12,
      anchor: 'start',
      offset: 18,
    },
    range: { category: [...theme.series], heatmap: [...theme.sequential] },
    // Marks: thin, 4px rounded data-end, >= 8px markers with a 2px surface ring.
    bar: { cornerRadiusEnd: 4 },
    point: { size: 90, filled: true, stroke: theme.surface, strokeWidth: 2 },
    line: { strokeWidth: 2, strokeCap: 'round', strokeJoin: 'round' },
    tick: { thickness: 2 },
    // Text wears text tokens, never the series color.
    text: { color: theme.ink, font: theme.font, fontSize: 11, fontWeight: 600 },
  }
}

/**
 * Left padding to reserve for long y-axis labels.
 *
 * Vega sizes guide-label gutters from an internal text estimator - it does not
 * measure the real font, in the browser or headlessly - and that estimate runs
 * about 10% narrow for our label set, so a long row label gets clipped by the
 * view box. Reserving the shortfall as view padding widens the gutter without
 * moving labels relative to the plot, and because both renderers share the same
 * estimator the correction keeps the report and the studio identical.
 */
function estLabelWidth(labels: readonly string[], fontSize = 11): number {
  return Math.max(0, ...labels.map((l) => l.length)) * fontSize * 0.55
}

function leftPadForLabels(labels: readonly string[], fontSize = 11): number {
  return Math.ceil(estLabelWidth(labels, fontSize) * 0.15) + 8
}

/** Air between neighbouring x labels before they read as one word. */
const LABEL_GAP = 14

/**
 * Widest plot we will grow to in order to keep x labels upright.
 *
 * The report page is 1120px less its gutters, and the studio canvas is
 * narrower still; past this the chart is scaled down to fit and the labels
 * shrink with it, which defeats the point of widening for them.
 */
const MAX_PLOT_WIDTH = 900

/** Matrix column width: comfortable for a stack label, capped by the budget. */
const MATRIX_STEP = 180
const MIN_MATRIX_STEP = 44

/**
 * Band width and label angle for a nominal x axis.
 *
 * Vega centres each label on its band and lets neighbours collide - it will
 * not widen a band to fit its text. With the harness on x that never showed,
 * because `codex` is 5 characters in a 72px band; with six model names on x,
 * `deepseek-v4-pro-0813` renders 117px wide into 78px and three of the six
 * labels overlap.
 *
 * Widening the band is the better fix where it fits: every label stays upright
 * and the bars keep their air. It stops fitting once the axis is long - 20
 * task names would demand a 3000px plot - so past MAX_PLOT_WIDTH the labels
 * tilt instead. At 30 degrees adjacent baselines clear each other for any band
 * wider than about 26px, so the tilt has slack the widening does not.
 */
function xAxisFit(domain: readonly string[], barStep: number): { step: number; labelAngle: number } {
  const needed = Math.ceil(estLabelWidth(domain)) + LABEL_GAP
  if (needed <= barStep) return { step: barStep, labelAngle: 0 }
  if (needed * domain.length <= MAX_PLOT_WIDTH) return { step: needed, labelAngle: 0 }
  return { step: barStep, labelAngle: -30 }
}

// -- spec builders ----------------------------------------------------------------

const label = (m: Measure) => MEASURE_LABEL[m]

function tooltipFields(dims: Dimension[], measure: Measure, fmt: (m: Measure) => string, extra: { field: string; title: string; format?: string }[] = []) {
  return [
    ...dims.map((d) => ({ field: d, type: 'nominal', title: DIMENSION_LABEL[d] })),
    { field: 'value', type: 'quantitative', title: label(measure), format: fmt(measure) },
    ...extra,
    { field: 'n', type: 'quantitative', title: 'Trials' },
  ]
}

export function buildChart(rows: TrialRow[], input: Partial<ChartState>): ChartOutput {
  const state: ChartState = { ...DEFAULT_STATE, ...input }
  const theme = THEMES[state.theme]
  const fmt = (m: Measure) => (m === state.measure && state.format ? state.format : MEASURE_FORMAT[m])
  const warnings: string[] = []

  // Color is refused past the palette's validated slot count. A fifth hue is
  // never generated; the user facets instead.
  let color: Dimension | 'none' = state.color
  if (color !== 'none' && color === state.x) color = 'none'
  if (color !== 'none') {
    const n = domainOf(rows, color).length
    if (n > MAX_SERIES) {
      warnings.push(`${DIMENSION_LABEL[color]} has ${n} values; the palette validates at most ${MAX_SERIES} series. Color was dropped - facet by it instead.`)
      color = 'none'
    }
  }

  const missingNote = (table: AggRow[], m: Measure) => {
    const missing = table.reduce((a, r) => a + r.missing, 0)
    if (missing) warnings.push(`${missing} trial${missing === 1 ? '' : 's'} excluded from ${label(m)}: the provider exposed no value.`)
  }

  const title = state.title || undefined
  const subtitle = state.subtitle || undefined
  const titleBlock = title ? { title: { text: title, subtitle } } : {}

  let spec: Record<string, unknown>
  let table: AggRow[]
  let columns: string[]

  switch (state.recipe) {
    case 'bar': {
      const dims: Dimension[] = [state.x, ...(color !== 'none' ? [color] : []), ...(state.facet !== 'none' ? [state.facet] : [])]
      table = aggregate(rows, dims, state.measure, state.aggregate)
      columns = [...dims, 'value', 'n', ...(table.some((r) => r.lo !== undefined) ? ['lo', 'hi'] : [])]
      missingNote(table, state.measure)
      const xDomain = sortedDomain(table, state.x, state.sort)
      const series = color !== 'none' ? domainOf(rows, color) : []
      const values = table.map((r) => r.value).filter((v): v is number => typeof v === 'number')
      if (values.length > 1 && Math.max(...values) === Math.min(...values)) {
        warnings.push(`No spread: every group scored ${formatValue(values[0], state.measure)}. This chart cannot discriminate between the stacks.`)
      }
      const minN = Math.min(...table.map((r) => r.n))
      if (state.measure === 'passed' && minN < 3) warnings.push(`Only ${minN} trial${minN === 1 ? '' : 's'} in the smallest group; the protocol asks for three attempts per stack before a pass rate is reported.`)

      const isRate = (state.measure === 'passed' || state.measure === 'reward') && state.aggregate !== 'sum'
      // Headroom above the tallest bar so direct labels never run into the legend.
      const yMax = isRate ? 1.12 : Math.max(...values, 0) * 1.18 || 1
      const yScale = { domain: [0, yMax], nice: false }
      const yAxis = isRate ? { format: fmt(state.measure), values: [0, 0.25, 0.5, 0.75, 1] } : { format: fmt(state.measure), tickCount: 5 }
      // One 32px slot per 24px bar, plus air on each side of the group - then
      // whatever more the x labels need to stay legible.
      const xLabels = [...new Set(table.map((r) => String(r[state.x])))]
      const { step, labelAngle } = xAxisFit(xLabels, Math.max(72, 32 * Math.max(series.length, 1) + 40))
      const encodingX = { field: state.x, type: 'nominal', sort: xDomain, title: null, axis: { labelAngle, labelLimit: 420 } }
      const encodingXOffset = color !== 'none' ? { xOffset: { field: color, type: 'nominal', sort: series } } : {}
      const encodingColor = color !== 'none'
        ? { color: { field: color, type: 'nominal', scale: { domain: series, range: theme.series.slice(0, series.length) }, legend: { title: DIMENSION_LABEL[color] } } }
        : { color: { value: theme.series[0] } }

      const layers: Record<string, unknown>[] = [
        {
          // Bars are capped at 24px; the band's leftover is air, never fill.
          mark: { type: 'bar', width: 24, cornerRadiusEnd: 4 },
          encoding: {
            x: encodingX,
            ...encodingXOffset,
            y: {
              field: 'value',
              type: 'quantitative',
              title: `${label(state.measure)}${state.aggregate === 'mean' ? '' : ` (${state.aggregate})`}`,
              axis: yAxis,
              scale: yScale,
            },
            ...encodingColor,
            tooltip: tooltipFields(dims, state.measure, fmt, table.some((r) => r.lo !== undefined)
              ? [{ field: 'lo', title: '95% low', format: '.0%' }, { field: 'hi', title: '95% high', format: '.0%' }]
              : []),
          },
        },
      ]
      if (state.intervals && table.some((r) => r.lo !== undefined)) {
        layers.push({
          mark: { type: 'rule', color: theme.ink, strokeWidth: 1.5, opacity: 0.7 },
          encoding: { x: encodingX, ...encodingXOffset, y: { field: 'lo', type: 'quantitative' }, y2: { field: 'hi' } },
        })
      }
      if (state.labels && series.length <= MAX_SERIES) {
        layers.push({
          mark: { type: 'text', dy: -8, baseline: 'bottom' },
          encoding: {
            x: encodingX,
            ...encodingXOffset,
            y: { field: state.intervals && table.some((r) => r.hi !== undefined) ? 'hi' : 'value', type: 'quantitative' },
            text: { field: 'value', type: 'quantitative', format: fmt(state.measure) },
            color: { value: theme.ink },
          },
        })
      }
      const inner: Record<string, unknown> = { width: { step }, height: 260, layer: layers }
      spec = state.facet !== 'none'
        ? { ...titleBlock, data: { values: table }, facet: { column: { field: state.facet, type: 'nominal', title: DIMENSION_LABEL[state.facet] } }, spec: inner, resolve: { scale: { y: 'shared' } } }
        : { ...titleBlock, data: { values: table }, ...inner }
      break
    }

    case 'scatter': {
      const dims: Dimension[] = [state.x, ...(color !== 'none' ? [color] : [])]
      table = aggregate(rows, dims, state.measure, state.aggregate, state.xMeasure)
      markFrontier(table)
      columns = [...dims, 'xValue', 'value', 'n', 'frontier']
      missingNote(table, state.xMeasure)
      const series = color !== 'none' ? domainOf(rows, color) : []
      const encodingColor = color !== 'none'
        ? { color: { field: color, type: 'nominal', scale: { domain: series, range: theme.series.slice(0, series.length) }, legend: { title: DIMENSION_LABEL[color] } } }
        : { color: { value: theme.series[0] } }
      const isRate = state.measure === 'passed' || state.measure === 'reward'
      const base = {
        x: { field: 'xValue', type: 'quantitative', title: `${label(state.xMeasure)} per trial (${state.aggregate})`, axis: { format: fmt(state.xMeasure), tickCount: 6 }, scale: { zero: true, nice: true } },
        y: { field: 'value', type: 'quantitative', title: label(state.measure), axis: { format: fmt(state.measure), tickCount: 5 }, scale: isRate ? { domain: [0, 1.05] } : { zero: true, nice: true } },
      }
      const layers: Record<string, unknown>[] = [
        {
          // Pareto frontier: a reference line in muted ink, not a data series.
          transform: [{ filter: 'datum.frontier' }],
          mark: { type: 'line', color: theme.inkMuted, strokeWidth: 1, opacity: 0.8, interpolate: 'monotone' },
          encoding: { x: base.x, y: base.y, order: { field: 'xValue' } },
        },
        {
          mark: { type: 'point' },
          encoding: {
            ...base,
            ...encodingColor,
            tooltip: tooltipFields(dims, state.measure, fmt, [
              { field: 'xValue', title: label(state.xMeasure), format: fmt(state.xMeasure) },
              { field: 'frontier', title: 'On frontier' },
            ]),
          },
        },
      ]
      if (state.labels) {
        layers.push({
          mark: { type: 'text', align: 'left', dx: 10, dy: -2, fontWeight: 500 },
          encoding: { ...base, text: { field: state.x, type: 'nominal' }, color: { value: theme.ink } },
        })
      }
      spec = { ...titleBlock, data: { values: table }, width: 520, height: 320, layer: layers }
      break
    }

    case 'strip': {
      const dims: Dimension[] = [state.x, ...(color !== 'none' ? [color] : []), ...(state.facet !== 'none' ? [state.facet] : [])]
      table = aggregate(rows, dims, state.measure, state.aggregate)
      columns = [...dims, 'value', 'n']
      missingNote(table, state.measure)
      const series = color !== 'none' ? domainOf(rows, color) : []
      const yDomain = sortedDomain(table, state.x, state.sort)
      const encodingColor = color !== 'none'
        ? { color: { field: color, type: 'nominal', scale: { domain: series, range: theme.series.slice(0, series.length) }, legend: { title: DIMENSION_LABEL[color] } } }
        : { color: { value: theme.series[0] } }
      const encodingY = { field: state.x, type: 'nominal', sort: yDomain, title: null, axis: { labelLimit: 420 } }
      const encodingYOffset = color !== 'none' ? { yOffset: { field: color, type: 'nominal', sort: series } } : {}
      const xEnc = { field: state.measure, type: 'quantitative', title: label(state.measure), axis: { format: fmt(state.measure), tickCount: 6 }, scale: { zero: true, nice: true } }
      const layers: Record<string, unknown>[] = [
        {
          mark: { type: 'point', opacity: 0.85 },
          encoding: {
            y: encodingY,
            ...encodingYOffset,
            x: xEnc,
            ...encodingColor,
            tooltip: [
              { field: 'trial', title: 'Trial' },
              { field: 'task', title: 'Task' },
              { field: 'agent', title: 'Harness' },
              { field: 'modelShort', title: 'Model' },
              { field: state.measure, title: label(state.measure), format: fmt(state.measure) },
              { field: 'passed', title: 'Passed' },
            ],
          },
        },
        {
          // Group aggregate as a tick in ink - identity comes from the row, not the color.
          mark: { type: 'tick', color: theme.ink, thickness: 2, size: 18 },
          encoding: { y: encodingY, ...encodingYOffset, x: { ...xEnc, aggregate: state.aggregate === 'sum' ? 'mean' : state.aggregate } },
        },
      ]
      // With a yOffset, `step` sizes the sub-band (one row per series), not the
      // whole group - multiplying by the series count here would stretch each
      // group to several times its content.
      const step = color !== 'none' ? 24 : 34
      const inner: Record<string, unknown> = {
        width: 520,
        height: { step },
        padding: { left: leftPadForLabels(yDomain ?? []), top: 8, right: 8, bottom: 8 },
        layer: layers,
      }
      spec = state.facet !== 'none'
        ? { ...titleBlock, data: { values: rows }, facet: { row: { field: state.facet, type: 'nominal', title: DIMENSION_LABEL[state.facet] } }, spec: inner, resolve: { scale: { x: 'shared' } } }
        : { ...titleBlock, data: { values: rows }, ...inner }
      break
    }

    case 'matrix': {
      const dims: Dimension[] = [state.row, state.x]
      table = aggregate(rows, dims, state.measure, state.aggregate)
      columns = [...dims, 'value', 'n']
      missingNote(table, state.measure)
      const isRate = state.measure === 'passed' || state.measure === 'reward'
      const values = table.map((r) => r.value).filter((v): v is number => typeof v === 'number')
      const [lo, hi] = isRate && state.aggregate !== 'sum' ? [0, 1] : [Math.min(0, ...values), Math.max(...values)]
      const mid = (lo + hi) / 2
      // The ramp runs light->dark in light mode and dark->light in dark mode, so
      // the readable ink flips at the midpoint in opposite directions.
      const inkOnCell = theme.mode === 'light'
        ? { condition: { test: `datum.value > ${mid}`, value: theme.surface }, value: theme.ink }
        : { condition: { test: `datum.value > ${mid}`, value: '#2c2a25' }, value: theme.ink }
      const xDomain = sortedDomain(table, state.x, state.sort)
      // Column labels can be long (a stack is "harness / model"). Break them at
      // the separator instead of truncating, and reserve the extra height by
      // hand: Vega measures one line, and the wrapped lines render downward from
      // the anchor, so without this the tail of the label lands inside the cells.
      const labelLines = Math.max(1, ...(xDomain ?? []).map((v) => v.split(' / ').length))
      const lineHeight = 13
      // 180px columns suit the handful of stacks this recipe was written for.
      // A task axis is an order of magnitude longer - 20 of them ask for a
      // 3600px plot, which the page then scales to a quarter size and renders
      // the labels at 3px. Fit the columns to the budget instead and tilt the
      // headers, which is the only way a long axis stays legible.
      const colCount = Math.max(1, xDomain?.length ?? 1)
      const roomy = MATRIX_STEP * colCount <= MAX_PLOT_WIDTH
      const colStep = roomy ? MATRIX_STEP : Math.max(MIN_MATRIX_STEP, Math.floor(MAX_PLOT_WIDTH / colCount))
      const layers: Record<string, unknown>[] = [
        {
          mark: { type: 'rect' },
          encoding: {
            color: {
              field: 'value',
              type: 'quantitative',
              scale: { domain: [lo, hi], range: [...theme.sequential] },
              legend: { title: label(state.measure), format: fmt(state.measure), direction: 'horizontal', gradientLength: 160, gradientThickness: 8 },
            },
            tooltip: tooltipFields(dims, state.measure, fmt),
          },
        },
      ]
      if (state.labels) {
        layers.push({
          mark: { type: 'text' },
          encoding: {
            text: { field: 'value', type: 'quantitative', format: fmt(state.measure) },
            color: inkOnCell,
          },
        })
      }
      spec = {
        ...titleBlock,
        data: { values: table },
        padding: { left: leftPadForLabels(sortedDomain(table, state.row, 'alpha') ?? []), top: 8, right: 8, bottom: 8 },
        width: { step: colStep },
        height: { step: 44 },
        // x and y are shared by both layers, so they are declared once here.
        // Repeating them per layer makes Vega-Lite merge two axis definitions
        // and size the label gutter from the merged result, which clips long
        // row labels.
        encoding: {
          x: {
            field: state.x,
            type: 'nominal',
            sort: xDomain,
            title: null,
            scale: { paddingInner: 0.05 },
            axis: roomy
              ? {
                  orient: 'top',
                  labelAngle: 0,
                  labelExpr: "split(datum.label, ' / ')",
                  labelLineHeight: lineHeight,
                  labelPadding: 8 + lineHeight * (labelLines - 1),
                  labelLimit: MATRIX_STEP - 5,
                }
              // Tilted labels read along the diagonal, so they neither wrap nor
              // need the reserved height - the anchor moves with the angle.
              : { orient: 'top', labelAngle: -45, labelPadding: 8, labelLimit: 400, labelAlign: 'left', labelBaseline: 'middle' },
          },
          y: {
            field: state.row,
            type: 'nominal',
            title: null,
            // 2px surface gap between cells via band padding, never a stroke.
            scale: { paddingInner: 0.08 },
            axis: { labelLimit: 420 },
          },
        },
        layer: layers,
      }
      break
    }
  }

  spec.$schema = 'https://vega.github.io/schema/vega-lite/v6.json'
  spec.config = vegaConfig(theme)
  spec.usermeta = { heval: { state: { ...state, color } } }

  return { spec: spec as unknown as TopLevelSpec, table, columns, warnings, theme }
}

export function formatValue(v: number | null | undefined, measure: Measure): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '-'
  switch (measure) {
    case 'passed':
    case 'reward':
      return `${Math.round(v * 100)}%`
    case 'costUsd':
      return `$${v.toFixed(v < 1 ? 3 : 2)}`
    case 'agentSeconds':
    case 'totalSeconds':
      return `${v.toFixed(1)}s`
    default:
      return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0)
  }
}
