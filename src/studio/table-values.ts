import { formatValue } from '../charts/recipes'
import { MEASURE_LABEL, DIMENSION_LABEL, type Measure, type Dimension } from '../charts/trial'

// -- table helpers -----------------------------------------------------------

export const NUMERIC = new Set(['value', 'xValue', 'n', 'lo', 'hi'])

export function columnLabel(c: string, measure: Measure, xMeasure: Measure): string {
  if (c === 'value') return MEASURE_LABEL[measure]
  if (c === 'xValue') return MEASURE_LABEL[xMeasure]
  if (c === 'n') return 'Trials'
  if (c === 'lo') return '95% low'
  if (c === 'hi') return '95% high'
  if (c === 'frontier') return 'On frontier'
  return DIMENSION_LABEL[c as Dimension] ?? c
}

export function cellText(v: unknown, c: string, measure: Measure, xMeasure: Measure): string {
  if (v === null || v === undefined) return '-'
  if (c === 'value' || c === 'lo' || c === 'hi') return formatValue(v as number, measure)
  if (c === 'xValue') return formatValue(v as number, xMeasure)
  if (typeof v === 'boolean') return v ? 'yes' : ''
  return String(v)
}
