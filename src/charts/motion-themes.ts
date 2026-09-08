import { POSTER_INK, POSTER_SURFACE, POSTER_WINNER, POSTER_COMPARISON_SERIES } from './poster'
/**
 * Themes for the social composition.
 *
 * The composition used to hardcode Merge Gateway's surface, palette, licensed
 * display face, lockup, and embossed background. A theme collects all of that
 * in one object so the video can be rendered in someone else's colors, or in a
 * plain one that carries no branding at all.
 *
 * No Node imports here: the editor's picker and the server share this file.
 * Themes that need a file on disk say so with a flag (`lockup`, `pattern`) and
 * `harbor/social/completion.ts` loads the asset. That keeps licensed fonts and
 * brand marks out of any theme that should not carry them.
 *
 * ## Adding a theme
 *
 * Copy an entry, give it a new key, and change the values. Every text colour is
 * checked against `surface` by `bun run social:check`, which fails on anything
 * below WCAG AA, so verify a new theme with that before shipping it.
 */

export type ThemeId = 'merge-gateway' | 'plain-dark' | 'plain-light'

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
  /** Embeds the licensed FH Oscar Pro faces. Merge themes only. */
  oscar: boolean
  /** Draws the Merge lockup SVG before the wordmark. */
  lockup: boolean
  /** Text beside the lockup. Empty renders nothing. */
  wordmark: string
  /** Opacity of the embossed brand background. 0 skips the asset entirely. */
  pattern: number
}

const INTER = "'Inter', system-ui, sans-serif"

export const MOTION_THEMES: Record<ThemeId, MotionTheme> = {
  // The original. These values match src/charts/poster.ts so the video and the
  // static poster stay the same artwork.
  'merge-gateway': {
    label: 'Merge Gateway',
    surface: POSTER_SURFACE,
    ink: POSTER_INK,
    series: [POSTER_WINNER, POSTER_COMPARISON_SERIES[0]],
    display: `'FH Oscar Pro', ${INTER}`,
    body: INTER,
    oscar: true,
    lockup: true,
    wordmark: 'Gateway',
    pattern: 0.32,
  },
  // Unbranded dark. No lockup, no emboss, no licensed face - the default to
  // reach for when the chart is not going out as Merge marketing.
  'plain-dark': {
    label: 'Plain dark',
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
    oscar: false,
    lockup: false,
    wordmark: 'Heval',
    pattern: 0,
  },
  'plain-light': {
    label: 'Plain light',
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
    oscar: false,
    lockup: false,
    wordmark: 'Heval',
    pattern: 0,
  },
}

export const THEME_IDS = Object.keys(MOTION_THEMES) as ThemeId[]

export const DEFAULT_THEME: ThemeId = 'merge-gateway'

/** Coerce an untrusted theme id. Unknown ids fall back rather than throwing. */
export function themeId(value: unknown): ThemeId {
  return typeof value === 'string' && value in MOTION_THEMES ? (value as ThemeId) : DEFAULT_THEME
}

export function motionTheme(value: unknown): MotionTheme {
  return MOTION_THEMES[themeId(value)]
}
