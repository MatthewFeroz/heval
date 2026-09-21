# Heval website design

Use the homepage's charcoal and off-white design across the website, including
Machines, Reports, the run workbench, and Studio. `src/tokens.css` owns the shared
palette, fonts, radii, and page dimensions. Import it in every page entry's CSS;
do not redefine the brand palette inside a route selector.

## Palette

| Role | Token | Value |
| --- | --- | --- |
| Page background | `--bg` | `#09090b` |
| Cards and panels | `--panel` | `#101012` |
| Raised controls | `--panel-2` | `#18181b` |
| Hover surfaces | `--panel-3` | `#202024` |
| Primary text | `--white` | `#f4f4f5` |
| Secondary text | `--text-secondary` | `#d4d4d8` |
| Supporting text | `--muted` | `#a1a1aa` |
| Quiet labels | `--faint` | `#85858f` |
| Primary action | `--accent` / `--accent-ink` | Off-white / charcoal |
| Card borders | `--line` | White at 8% opacity |
| Control borders | `--line-strong` | White at 19% opacity |

Use green for success, amber for warnings, and coral for errors through the
`--pass-*`, `--warn-*`, and `--fail-*` tokens. Status labels must also include text.
Selections and ordinary buttons use neutral colors, not success green.

## Typography

DM Sans (`--sans`) is the heading, body, navigation, button, and form typeface.
The variable font is served locally from `public/fonts/dm-sans-latin.woff2`, with
its license beside it. Use weight 400 for body copy, 500 for headings and navigation,
and 600 for actions. Headings use tight spacing, around `-.035em` to `-.055em`.

DM Mono (`--mono`) is reserved for commands, identifiers, compact metric labels,
and technical metadata, with system monospace fallbacks. Normal interface prose
and form labels stay in DM Sans. Workspace body copy is 14px with a 1.6–1.7 line
height; introductions are 16px. Page headings scale from 32px to 48px. The marketing
hero may be larger and the Studio editor denser without changing typefaces.

## Shared components and layout

`src/components/SiteHeader.tsx` owns the lowercase wordmark and site header.
Marketing keeps the compact GitHub/sign-in navigation. Workspace pages expose
Evaluations, Runner setup, and Report library, with `aria-current` on the active route.
Studio's editing toolbar reuses `Brand` while keeping its editor-specific tools.

`src/reports/WorkspaceLayout.tsx` supplies the shared header, content container,
and footer for Machines and Reports, including storage-unavailable states.
Keep the desktop container at `--page-width` (1180px), with 32px side gutters,
reducing to 20px on phones. Standard controls use `--radius-control` (8px),
cards use `--radius-card` (14px), and pills use `--radius-pill`.

Forms use charcoal fields, visible borders, off-white primary buttons, and outlined
secondary buttons. Provide visible keyboard focus, hover and disabled states.
Machines uses two columns above 800px and a single column below it. Navigation
wraps on narrow screens rather than widening the document.

Chart canvases, exported report/poster themes, and third-party terminal illustrations
have their own deliberate palettes. Keep those data and artifact themes separate
from the shared website controls around them.
