import { POSTER_INK, POSTER_DESIGNER_SURFACE, POSTER_WINNER, POSTER_COMPARISON_SERIES } from './poster'
/**
 * Complete, named publishing themes. Merge tokens follow the weekly benchmark skill.
 *
 * `merge-dark` is the default (see SOCIAL_DEFAULTS) and renders on
 * POSTER_DESIGNER_SURFACE, the same near-black the poster exporter uses, so a
 * chart published from the hosted app and one built from the CLI are the same
 * artwork. It used to sit on Merge Charcoal, which made those two paths
 * disagree by a shade that was obvious once both appeared in one thread.
 */
export const SOCIAL_THEMES = {
  'merge-dark': {
    label: 'Merge Gateway dark',
    brand: true,
    display: 'FH Oscar Pro,Inter,sans-serif',
    surface: POSTER_DESIGNER_SURFACE,
    primary: POSTER_INK.primary,
    muted: POSTER_INK.muted,
    line: POSTER_INK.line,
    winner: POSTER_WINNER,
    series: POSTER_COMPARISON_SERIES,
    pass: '#63725A',
    fail: '#565551',
    cell: '#F5F2EE',
  },
  'merge-light': {
    label: 'Merge Gateway light',
    brand: true,
    display: 'FH Oscar Pro,Inter,sans-serif',
    surface: '#F5F2EE',
    primary: '#12110F',
    muted: '#565551',
    line: '#ABAAA8',
    winner: POSTER_WINNER,
    series: POSTER_COMPARISON_SERIES,
    pass: '#BEC7B8',
    fail: '#EAEAE9',
    cell: '#12110F',
  },
  'plain-light': {
    label: 'Plain report',
    brand: false,
    display: 'Inter,system-ui,sans-serif',
    surface: '#FFFFFF',
    primary: '#12110F',
    muted: '#565551',
    line: '#ABAAA8',
    winner: '#698490',
    series: ['#ABAAA8', '#87857F', '#C3C5B3', '#96A58D', '#769399'],
    pass: '#BEC7B8',
    fail: '#EAEAE9',
    cell: '#12110F',
  },
} as const
export type SocialTheme = keyof typeof SOCIAL_THEMES
