import { POSTER_INK, POSTER_DESIGNER_SURFACE, POSTER_WINNER, POSTER_COMPARISON_SERIES } from './poster'
/** Neutral themes are the product defaults. Merge branding is opt-in. */
export const SOCIAL_THEMES = {
  'plain-light': {
    label: 'White', brand: false, display: 'Inter,system-ui,sans-serif',
    surface: '#FFFFFF', primary: '#171717', muted: '#525252', line: '#D4D4D4',
    winner: '#525252', series: ['#737373', '#737373', '#737373', '#737373', '#737373'],
    pass: '#E5E5E5', fail: '#FFFFFF', cell: '#171717',
  },
  'plain-dark': {
    label: 'Black', brand: false, display: 'Inter,system-ui,sans-serif',
    surface: '#111111', primary: '#FAFAFA', muted: '#BDBDBD', line: '#404040',
    winner: '#D4D4D4', series: ['#A3A3A3', '#A3A3A3', '#A3A3A3', '#A3A3A3', '#A3A3A3'],
    pass: '#404040', fail: '#171717', cell: '#FAFAFA',
  },
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

} as const
export type SocialTheme = keyof typeof SOCIAL_THEMES
