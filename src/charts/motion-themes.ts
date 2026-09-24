import { PRESENTATION_DEFAULT_THEME } from './presentation-defaults'
/** Neutral presentation themes shared by the editor and renderer. */

export type ThemeId = 'plain-dark' | 'plain-light'

export type MotionTheme = {
  /** Shown in the editor's picker. */
  label: string
  /** Canvas colour. Every text colour is contrast-checked against it. */
  surface: string
  ink: {
    /** Title and the leading value label. */
    primary: string
    /** Bar category labels. */
    secondary: string
    /** Axis ticks, kicker, footer. */
    muted: string
    /** Baseline and the rule under the panel heading. Not text. */
    line: string
    /** The "higher is better" cue. */
    good: string
  }
  /** `[leading bar, every other bar]`. One accent only. */
  series: readonly [string, string]
  /** Font stack for the headline. */
  display: string
  /** Font stack for everything else. */
  body: string
  /** Whether a custom lockup is available. */
  lockup: boolean
  /** Text beside the lockup. Empty renders nothing. */
  wordmark: string
  /** Opacity of the embossed brand background. 0 skips the asset entirely. */
  pattern: number
}

const INTER = "'Inter', system-ui, sans-serif"

export const MOTION_THEMES: Record<ThemeId, MotionTheme> = {
  'plain-dark': {
    label: 'Black',
    surface: '#141617',
    ink: {
      primary: '#F2F4F5',
      secondary: '#F2F4F5',
      muted: '#A8B0B4',
      line: '#3A4043',
      good: '#A8B0B4',
    },
    series: ['#7FB2E5', '#71777B'],
    display: INTER,
    body: INTER,
    lockup: false,
    wordmark: 'Heval',
    pattern: 0,
  },
  'plain-light': {
    label: 'White',
    surface: '#FFFFFF',
    ink: {
      primary: '#111315',
      secondary: '#111315',
      muted: '#5B6367',
      line: '#D6DADC',
      good: '#5B6367',
    },
    series: ['#2F6FA8', '#A9B0B4'],
    display: INTER,
    body: INTER,
    lockup: false,
    wordmark: 'Heval',
    pattern: 0,
  },
}

export const THEME_IDS: ThemeId[] = ['plain-light', 'plain-dark']

export const DEFAULT_THEME: ThemeId = PRESENTATION_DEFAULT_THEME

/** Coerce an untrusted theme id. Unknown ids fall back rather than throwing. */
export function themeId(value: unknown): ThemeId {
  return typeof value === 'string' && value in MOTION_THEMES ? (value as ThemeId) : DEFAULT_THEME
}

export function motionTheme(value: unknown): MotionTheme {
  return MOTION_THEMES[themeId(value)]
}
