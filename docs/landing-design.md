# Homepage design sources

The Heval homepage adapts the typography, dark grid, floating agent cards,
staggered entrances, pointer parallax, and preview tilt from [T3 Code](https://t3.codes/).
The implementation was inspected on 2026-09-16 and adapted to React, Heval's
evaluation workflows, and its seven featured ecosystem projects.

Upstream sources:

- [Hero markup and CSS](https://github.com/pingdotgg/t3code/blob/main/apps/marketing/src/pages/index.astro)
- [Visibility-aware motion](https://github.com/pingdotgg/t3code/blob/main/apps/marketing/src/lib/homeMotion.ts)
- [Typography and entrance styles](https://github.com/pingdotgg/t3code/blob/main/apps/marketing/src/layouts/Layout.astro)

T3 Code is Copyright (c) 2026 T3 Tools Inc., MIT licensed. The full notice is
retained in [public/licenses/t3-code-MIT.txt](../public/licenses/t3-code-MIT.txt)
and shipped with the website. DM Sans is self-hosted with its
[SIL Open Font License](../public/fonts/DM-Sans-LICENSE.txt).
Third-party marks are documented in [harness sources](../public/harnesses/SOURCES.md).

The featured cards identify the ecosystem; adding Grok to this presentation
does not add a Grok execution adapter. The measured comparisons, sample replay,
reports, Studio, and connected-machine entry points retain Heval's own data and behavior.

Motion stops for reduced-motion preferences and pauses outside the viewport or
when the tab is hidden. Pointer parallax is enabled only for a fine pointer.
The icons are non-interactive images with accessible names for screen readers;
no links, visible text labels, or hover highlights are shown.
