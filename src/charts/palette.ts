/**
 * Chart palette - the Merge brand plugged into the dataviz method.
 *
 * Everything here was chosen by the validator, not by eye. Both modes are
 * SELECTED: the dark column is the same hues re-stepped for the dark surface,
 * validated as its own set, never a flipped copy of light.
 *
 * CATEGORICAL. Four slots, fixed order, all-pairs pairlist (so the same palette
 * is legal on scatterplots, not just adjacent bars). Slots 1-2 are Merge's Robin
 * and Orange snapped past the chroma floor (their brand steps sit at C ~0.05 and
 * read as gray as data marks). Slots 3-4 were found by enumerating OKLCH steps
 * with the validator and keeping only orderings that clear every gate.
 *
 *   light  #ffffff surface  -> ALL CHECKS PASS
 *          worst all-pairs CVD dE 11.0 (protan), normal-vision dE 22.0
 *   dark   #3a3833 surface  -> ALL CHECKS PASS
 *          worst all-pairs CVD dE 7.3 (deutan) - the 6-8 floor band, which is
 *          legal ONLY with secondary encoding. Every recipe therefore ships a
 *          legend, direct labels (<= 4 series), and a table view; do not remove
 *          those to "clean up" a dark chart.
 *
 * A fifth categorical value is never a generated hue. `recipes.ts` refuses the
 * color channel past four values and tells the user to facet instead.
 *
 * SEQUENTIAL. One hue (Robin, OKLCH h 227), light -> dark, seven steps, its own
 * ramp per mode. Used for the per-task matrix where the job is magnitude.
 *
 * Re-validate after any change:
 *   node <dataviz>/scripts/validate_palette.js "<hex,...>" --mode light --surface "#ffffff" --pairs all
 *   node <dataviz>/scripts/validate_palette.js "<hex,...>" --mode dark  --surface "#3a3833" --pairs all
 */

export type ThemeMode = 'light' | 'dark'

export type Theme = {
  mode: ThemeMode
  /** Page background. */
  bg: string
  /** Chart surface (cards). The validator's surface. */
  surface: string
  ink: string
  inkMuted: string
  grid: string
  /** Categorical slots, fixed order. */
  series: readonly [string, string, string, string]
  /** Sequential ramp, light -> dark in reading order for that mode. */
  sequential: readonly string[]
  font: string
}

const FONT = 'system-ui, sans-serif'

export const THEMES: Record<ThemeMode, Theme> = {
  light: {
    mode: 'light',
    bg: '#f5f2ee',
    surface: '#ffffff',
    ink: '#2c2a25',
    inkMuted: '#807f7c',
    grid: '#eaeae9',
    series: ['#0087ae', '#c76839', '#6e396a', '#255f16'],
    sequential: ['#d4ecf8', '#a5d6ed', '#6fbdde', '#39a2c9', '#0087ad', '#006b8c', '#00506d'],
    font: FONT,
  },
  dark: {
    mode: 'dark',
    bg: '#2c2a25',
    surface: '#3a3833',
    ink: '#f5f2ee',
    inkMuted: '#abaaa8',
    grid: '#565551',
    series: ['#179fd4', '#c7692c', '#bf77a7', '#5da56e'],
    sequential: ['#25414d', '#1f5a70', '#027495', '#198db3', '#4aa5c8', '#78bcd9', '#a2d3e9'],
    font: FONT,
  },
}

/** Hard cap on categorical series - past this the palette cannot validate. */
export const MAX_SERIES = 4
