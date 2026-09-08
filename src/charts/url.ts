/**
 * ChartState <-> URL query, shared by the report's "Open in studio" links and
 * the studio itself. One parser on both ends means a link the report writes is
 * always a state the editor can load, and a state the editor holds is always a
 * link someone else can open.
 *
 * Unknown or malformed values fall back to the default rather than throwing: a
 * hand-edited URL should degrade to a working chart, not a blank page.
 */

import { DEFAULT_STATE, type Aggregate, type ChartState, type Recipe, type SortOrder } from './recipes'
import type { ThemeMode } from './palette'
import { DIMENSIONS, MEASURES, type Dimension, type Measure } from './trial'

const RECIPES: Recipe[] = ['bar', 'scatter', 'strip', 'matrix']
const AGGREGATES: Aggregate[] = ['mean', 'median', 'sum', 'min', 'max']
const SORTS: SortOrder[] = ['alpha', 'desc', 'asc']
const MODES: ThemeMode[] = ['light', 'dark']

const pick = <T extends string>(allowed: readonly T[], v: string | null): T | undefined =>
  v !== null && (allowed as readonly string[]).includes(v) ? (v as T) : undefined

const dim = (v: string | null): Dimension | undefined => v?.startsWith('custom:') ? v : pick(DIMENSIONS, v)
const dimOrNone = (v: string | null): Dimension | 'none' | undefined =>
  v === 'none' ? 'none' : dim(v)
const measure = (v: string | null): Measure | undefined => v?.startsWith('custom:') ? v : pick(MEASURES, v)
const bool = (v: string | null): boolean | undefined =>
  v === null ? undefined : v === '1' || v === 'true'

/** Serializes every set field; a link should be explicit, not default-dependent. */
export function paramsFromState(state: Partial<ChartState>, extra: Record<string, string> = {}): URLSearchParams {
  const params = new URLSearchParams(extra)
  for (const [k, v] of Object.entries(state)) {
    if (v === undefined || v === '') continue
    params.set(k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v))
  }
  return params
}

export function stateFromParams(params: URLSearchParams): Partial<ChartState> {
  const out: Partial<ChartState> = {}
  const set = <K extends keyof ChartState>(key: K, value: ChartState[K] | undefined) => {
    if (value !== undefined) out[key] = value
  }
  set('recipe', pick(RECIPES, params.get('recipe')))
  set('x', dim(params.get('x')))
  set('color', dimOrNone(params.get('color')))
  set('facet', dimOrNone(params.get('facet')))
  set('row', dim(params.get('row')))
  set('measure', measure(params.get('measure')))
  set('xMeasure', measure(params.get('xMeasure')))
  set('aggregate', pick(AGGREGATES, params.get('aggregate')))
  set('sort', pick(SORTS, params.get('sort')))
  set('labels', bool(params.get('labels')))
  set('intervals', bool(params.get('intervals')))
  set('theme', pick(MODES, params.get('theme')))
  set('title', params.get('title') ?? undefined)
  set('subtitle', params.get('subtitle') ?? undefined)
  set('format', params.get('format') ?? undefined)
  return out
}

/** Full state with defaults filled in, plus the job the params point at. */
export function readUrl(search: string): { job: string | null; state: ChartState } {
  const params = new URLSearchParams(search)
  return { job: params.get('job'), state: { ...DEFAULT_STATE, ...stateFromParams(params) } }
}
