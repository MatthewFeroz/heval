# How Heval works

A plain walkthrough of the product: what each page is for, where the data comes
from, and which knobs live in the UI versus the code.

For the production boundary and the sandbox story, see
[`architecture.md`](architecture.md). For the evaluation protocol, see
[the evaluation walkthrough](current-evaluation-flow.md).

## What Heval does

It creates an evaluation in the browser, runs the selected matrix through Harbor
on your connected machine, records every attempt, and combines the results into
one inspectable and publishable report.

One experiment can contain several harness/model runs. Each run produces trial
rows; the experiment report combines those rows and becomes the source for its
chart, table and published view.

## Current pages and execution paths

Start with [Current architecture and running an evaluation](current-evaluation-flow.md)
for a code-verified walkthrough, including the distinction between direct Harbor,
connected machines, and the older Bun fixture workbench.

| URL | Purpose |
| --- | --- |
| `/` | Product landing and recorded demo |
| `/evaluations` | Create, run, inspect and publish one evaluation |
| `/machines` | Pair and diagnose a Linux runner |
| `/reports` | Find saved results or import external results |
| `/studio` | Edit an evaluation's analysis and presentation |
| `/share` | View an explicitly shared report |

Hosted workspace features require WorkOS and Convex. Direct Harbor execution and
local result viewing do not require a Heval account.

## The connected evaluation pipeline

Five steps, in order.

**1. Configure.** `/evaluations` builds an approved matrix from the task sets,
harnesses, models and vendor advertised by one connected runner.

**2. Run.** Convex queues each matrix cell. The outbound CLI runner claims it,
and an independent supervisor executes Harbor and Docker on the machine.

**3. Normalize and combine.** Raw Harbor artifacts stay on the machine. The
runner uploads sanitized rows for each cell; after every cell is terminal,
Convex creates one combined experiment report from the available rows.

**4. Inspect and edit.** The experiment page shows run-level diagnostics plus
the combined chart and trial table. Studio edits that same saved report.

**5. Publish.** Creating a public link freezes the current presentation version.
Later edits remain drafts until explicitly published; access can be revoked.

## Direct Harbor and imported results

For full control outside the connected profile limits, a Harbor run produces
raw output in `jobs/<job-name>/`. Normalize it with:

```bash
bun run report jobs/demo-evaluation
```

That writes three things into `results/harbor/`:

- `<job>.json` — one row per trial, the same shape every view reads
- `<job>.html` — a self-contained static report you can email
- `index.json` — the catalog the studio's job picker lists

The studio loads the normalized JSON. The job picker at the top reads
`index.json`. Selecting a job fetches that job's `.json`. The URL carries the
job and the chart state, so any view you build is a link.

Exports come off the same job file, so they cannot
disagree about the numbers.

## The Studio tabs

The left sidebar (Recipe, Group by, Color, Facet, Value, Aggregate, Sort, value
labels, intervals, Title, Subtitle) drives the **Chart** tab only. It is a
Vega-Lite chart. Those controls do not affect the video.

| Tab | What it shows |
| --- | --- |
| Chart | The interactive Vega-Lite chart. Export as SVG or PNG @2x from the header. |
| Motion | The video, with its own controls. |
| Table view | The numbers the chart marks encode, after aggregation. |
| Vega-Lite spec | The generated spec, to copy out. |
| Raw trials | Every trial row, unaggregated. |

The tab row sits below the stat tiles and the filter chips, not at the top of
the page.

## The Motion tab

The video is not a video file. It is an HTML page — one `<div>` per bar, styled
with CSS, animated by a GSAP timeline. The server generates that page on every
request from `harbor/social/completion.ts`, so a saved edit shows up on refresh.
It is 30 fps, silent, and 8 seconds by default. The Canvas control picks the frame (16:9 1600×900, 1:1 1200×1200, or 9:16 1080×1920); the Length control changes the runtime.

**The numbers are not editable.** Bar values come from `buildPanel()` over the
trial rows, the same function the static poster uses. The controls change how
the chart is drawn, not what it measures. The one asterisk is the axis floor:
it cannot change a value, but it can make equal gaps look unequal, which is why
the editor warns when you raise it.

### The controls

| Control | What it does |
| --- | --- |
| **Theme** | Palette, fonts, and branding. Three ship today; see below. |
| **Canvas** | Frame size. Landscape 1600×900, square 1200×1200, or portrait 1080×1920. The plot fills whatever is left after padding, so a taller frame is more plot, not bigger type. |
| **Title** | Replaces the headline. Blank keeps the built-in. Capped at 72 characters. |
| **Kicker** | Line under the title. Blank keeps the built-in (trial counts). |
| **Cue** | Line above the plot. Blank keeps the built-in direction line. |
| **Footer left** | Left footer line. Blank keeps the built-in note. |
| **Footer right** | Right footer line. Blank keeps the built-in credit. |
| **Text size** | Multiplies every label, 85%–135%. The composition's sizes are a 0.75 reduction of the drawn design, so 133% is the authored size. Padding does not scale. |
| **Length** | Runtime, 4–12 seconds. The whole timeline stretches to fit, so the reveal always completes; a 5-second export and a 12-second one end on the same frame. |
| **Axis ceiling** | Top of the scale. This is the control for empty space above the bars. At an 80% ceiling a 70% bar fills 87.5% of the plot; at 100% it fills 70%. |
| **Axis floor** | Bottom of the scale. Leave it at 0%. Above 0% it truncates the baseline, so bar length stops matching the value — and because it shrinks the span rather than the sky, it *adds* empty space. The editor warns when you raise it. |
| **Tick labels** | Vertical nudge for the `0% / 20% / …` labels, as a percent of label height. `0%` centers each label on its gridline, which is the accurate position. `-28%` is the default and sits them lower. |
| **Plot rule** | The 1px line above the plot. Uncheck it to remove that line. The 0% baseline and the footer rule stay. Independent of the direction cue above the plot. |
| **Reset all** | Every control back to defaults. Separate from the sidebar's Reset, which clears chart state. |
| **Replay** | Restarts the timeline. No re-render. |

Sliders apply after a 350 ms pause, because each change rebuilds a page with
the fonts inlined. The values ride in the player's URL, so a non-default axis is
visible in the query string and the URL stays clean at defaults.

### Themes

Public presentations offer two neutral themes: **White** (`plain-light`) and
**Black** (`plain-dark`). Their font stacks and colors live in
`src/charts/motion-themes.ts` and `src/charts/social-themes.ts`. No corporate
logos, licensed display fonts, or branded backgrounds are included. Unknown
motion theme IDs fall back to the neutral default.

#### Adding one

Copy an entry in `MOTION_THEMES`, give it a new key, and change the values. The
key is the id that travels in the URL; `label` is what the picker shows. Nothing
else needs editing — the picker and the server both read the same object, so a
new theme appears in the dropdown and is accepted by the exporter at once.

Verify it before you ship it. Every text colour is checked against the theme's
`surface`, and a theme that fails WCAG AA will fail the check:

```bash
bun run social:check
```

That only checks the on-disk default. To check a specific theme, write it out
with `writeCompletionComposition(input, outDir, completionOptions({ theme }))`
and point `hyperframes check` at the result. All three shipped themes pass at
55/55 text checks.

### The export buttons

| Button | How it is made |
| --- | --- |
| **MP4** | `hyperframes render` over the composition, 30 fps, high quality, strict |
| **PNG** | A single snapshot 0.1 s before the end — the final frame, after the animation settles. Tracks the Length control. |
| **JPEG** | That PNG through `ffmpeg -q:v 2` |

Each export renders in its own temporary directory with the options from that
request, so two people previewing different axes cannot get each other's file.
One render runs at a time; a second request gets a 409 and can retry.

Exports download to your browser. They are not written into the repository.

## Running it

```bash
bun install
bun run build                                  # compile the studio into dist/
HEVAL_ENABLE_EXPORTS=1 bun server/index.ts     # serve on :4173
```

Use `bun --watch server/index.ts` while editing the composition — a save
restarts the server and the next refresh regenerates the video. Editing the
studio UI needs `bun run build`, because the server serves prebuilt `dist/`.

`PORT` moves the server. `bun run dev` starts Vite on :5173 with hot reload, but
it does not proxy `/api/*`, so exports do not work there.

### Flags

| Variable | Effect |
| --- | --- |
| `HEVAL_ENABLE_EXPORTS=1` | Loads the player and enables the export endpoint. Without it the Motion tab says exports are disabled. |
| `HEVAL_ENABLE_RUNNER=1` | Allows real evaluation runs. Also needs WorkOS client IDs; run requests are rejected without a valid token. |
| `HEVAL_GATEWAY_API_KEY` | Merge Gateway key for runs. Keep it in `.env.local`, never committed. |
| `HEVAL_GATEWAY_MODEL` | Pinned model. Leave it pinned so comparisons stay reproducible. |

### Commands

| Command | What it does |
| --- | --- |
| `bun run report jobs/<job>` | Normalize a job, write the JSON, static report, and catalog entry |
| `bun run poster` | Static poster PNGs |
| `bun run social:build` | Write the composition to `results/harbor/social/<job>/` using defaults |
| `bun run social:check` | Render sample frames and check motion plus WCAG AA contrast |
| `bun run status` | Job status |
| `bun run test:e2e` | Playwright tests |
| `bun run lint` | ESLint |

## Where things live

```text
jobs/<job>/                      raw harness output
results/harbor/<job>.json        normalized rows - what every view reads
results/harbor/<job>.html        static report
results/harbor/index.json        job catalog for the picker
results/harbor/social/<job>/     composition written by social:build
harbor/report/build-report.ts    job -> rows + static report
harbor/social/completion.ts      the video: markup, CSS, GSAP timeline
src/charts/poster.ts             buildPanel - bar values, ticks, axis scale
src/charts/motion-options.ts     the Motion controls, shared by UI and server
src/charts/motion-themes.ts      themes: palette, fonts, branding switches
src/studio/Studio.tsx            the studio page and its tabs
src/studio/MotionPreview.tsx     the Motion tab and its controls
server/index.ts                  routes
server/social-export.ts          composition generation and media rendering
```

## What is still code-only

The Motion tab exposes theme, canvas, copy (title, kicker, cue, footer), text size, length, axis, tick labels, and the plot rule.
These are not in the UI:

- **Animation choreography** — the GSAP timeline at the bottom of
  `completion.ts`. Cues are written as their share of an 8-second runtime and
  multiplied by `t()`, so the Length control stretches them all together.
  `1.35 + index * .58` is the bar stagger; `5.15` is when the leader turns
  accent; `5.45` is the footer fade. Change these to re-choreograph, not to
  change the runtime.
- **The wordmark** — a theme value in `motion-themes.ts`, not a control. Change
  it there, or add a theme.
- **Frame rate** — `COMPLETION_VIDEO.fps` at the top of `completion.ts`. 30.
  Canvas size is the Canvas dropdown.
- **Colors and layout** — the `<style>` block, fed by the selected theme.

One caveat on the shared scale: `PANELS.completion` in `src/charts/poster.ts` is
pinned to a 0–1 zero baseline for the poster and the static report. The video
passes its own ceiling instead of editing that, so the Motion controls never
change what the report shows.
