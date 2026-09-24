/** Shared chart colors for public reports and Studio. */

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

/** Open font stack shared across data labels and report headings. */
const FONT = 'Inter, system-ui, sans-serif'

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
    bg: '#12110F',
    surface: '#12110F',
    ink: '#F5F2EE',
    inkMuted: '#D6CFC7',
    grid: '#5A5751',
    series: ['#96BDCE', '#7C8F70', '#BBA7C7', '#B5A898'],
    sequential: ['#3B4A50', '#4D6872', '#608592', '#75A2B1', '#96BDCE', '#B5D0DA', '#D5E4E9'],
    font: FONT,
  },
}

/** Hard cap on categorical series - past this the palette cannot validate. */
export const MAX_SERIES = 4
