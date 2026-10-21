# Homepage design sources

The Heval homepage adapts the typography, dark grid, floating agent cards,
staggered entrances, pointer parallax, and preview sizing from [T3 Code](https://t3.codes/).
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
does not add execution adapters. The measured comparisons, run database,
reports, Studio, and connected-machine entry points retain Heval's own data and behavior.

Motion stops for reduced-motion preferences and pauses outside the viewport or
when the tab is hidden. Pointer parallax is enabled only for a fine pointer.
The icons are non-interactive images with accessible names for screen readers;
no links, visible text labels, or hover highlights are shown.


Below the hero, the run database replaces the earlier scripted four-terminal
replay. It shows every trial from the published studies as a task-by-stack grid:
one row per task, one column per harness or model, and one cell per attempt with
its verifier outcome and agent time. Selecting two cells compares them and lists
what the comparison held constant and what it changed, so a cross-task or
cross-harness pairing is disclosed rather than implied. The study, the two
selected trials stay in the URL for sharing.

A cost-versus-agent-time scatter plot above the grid uses the same trials and
A/B selection. Colors identify stacks; filled dots passed and rings failed or
timed out. Diamonds show separate median cost and time across the plotted trials
in each stack, including failures, rather than an observed trial. Hover or
keyboard focus reveals the task, outcome, measurements and recorded cost source.
Arrow keys move between dots; Enter or Space selects one. Chart legend buttons
hide stacks without changing the axis domains or removing rows from the grid.
The existing outcome highlight applies to both views.

Both axes default to logarithmic scales to keep the full cost range visible.
Linear scales include genuine zero measurements. Missing, invalid and
log-incompatible values are counted explicitly and remain inspectable in the
grid. No metrics are inferred from missing values, and outliers are not clipped.

The data comes from the owner-approved normalized snapshot in
`src/runs/run-database.json`. It contains 260 trials from two published studies.
Only the listed browser fields are included. Raw reports, logs, worker paths,
proxy routing details and credentials are not published here. Missing metrics
read "not recorded". The snapshot was checked against the private source reports
before release; public tests check the recorded headline numbers, comparisons,
selection and measurement handling without requiring those private files.

`bun run runs:build` rebuilds the snapshot only when the operator separately
supplies the approved normalized source reports listed in `src/runs/build.ts`.
Those inputs are intentionally absent from the public checkout. Review any
replacement snapshot before publishing it. `build:showcase` includes the approved
run database; `build:public` retains the separate synthetic workbench demo. CLI
examples and the public demo catalog remain synthetic and unchanged.

The section keeps the earlier 1,176-pixel content width. Below 1,040 pixels the
comparison moves under the grid; on phones the grid scrolls sideways with the
task column pinned.

The homepage's palette and DM Sans typography now form the shared
[website design system](design-system.md). Its font registration and brand tokens
live in `src/tokens.css`; Machines, Reports, the workbench, and Studio consume them.
