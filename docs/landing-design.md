# Homepage design sources

The Heval homepage adapts the typography, dark grid, floating agent cards,
staggered entrances, pointer parallax, and preview tilt from [T3 Code](https://t3.codes/).
The implementation was inspected on 2026-09-16 and adapted to React, Heval's
evaluation workflows, and its eight featured ecosystem projects.

Upstream sources:

- [Hero markup and CSS](https://github.com/pingdotgg/t3code/blob/main/apps/marketing/src/pages/index.astro)
- [Visibility-aware motion](https://github.com/pingdotgg/t3code/blob/main/apps/marketing/src/lib/homeMotion.ts)
- [Typography and entrance styles](https://github.com/pingdotgg/t3code/blob/main/apps/marketing/src/layouts/Layout.astro)

T3 Code is Copyright (c) 2026 T3 Tools Inc., MIT licensed. The full notice is
retained in [public/licenses/t3-code-MIT.txt](../public/licenses/t3-code-MIT.txt)
and shipped with the website. DM Sans is self-hosted with its
[SIL Open Font License](../public/fonts/DM-Sans-LICENSE.txt).
Third-party marks are documented in [harness sources](../public/harnesses/SOURCES.md).

The featured cards identify the ecosystem; adding Grok and Cursor to this presentation
does not add execution adapters. The measured comparisons, sample replay,
reports, Studio, and connected-machine entry points retain Heval's own data and behavior.

Motion stops for reduced-motion preferences and pauses outside the viewport or
when the tab is hidden. Pointer parallax is enabled only for a fine pointer.
The icons are non-interactive images with accessible names for screen readers;
no links, visible text labels, or hover highlights are shown.


The replay uses the same horizontal sizing as T3's preview: a 1,240-pixel
container with 32-pixel padding gives 1,176 pixels of content at full width.
Below 960 pixels, the preview uses `min(860px, 100vw - 24px)` and stays centered.
T3 hides its static preview at 820 pixels; Heval keeps the interactive replay
available on phones with those same 12-pixel side margins.

Terminal startup layouts were checked against locally installed Claude Code
2.1.270, Codex 0.154.0, OpenCode 1.18.30, and Pi 0.85.1 on 2026-09-16.
The ANSI renderers reproduce their logo, prompt, help, border, and status layouts
with the sample fixture's versions and model configuration. They use a generic
project path and omit account details, update notices, and personalized tips.
These are responsive illustrations, not live CLI sessions or screenshots.
The panels start idle; sample events appear only after playback starts.
Xterm's rendered cell dimensions determine the columns and rows on resize,
including when a lane is focused, so text and borders fit the available space.
