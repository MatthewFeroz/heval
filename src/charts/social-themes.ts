/** Neutral public presentation themes. */
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
} as const
export type SocialTheme = keyof typeof SOCIAL_THEMES
