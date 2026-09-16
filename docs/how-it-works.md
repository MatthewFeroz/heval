# How Heval works

A plain walkthrough of the product: what each page is for, where the data comes
from, and which knobs live in the UI versus the code.

For the production boundary and the sandbox story, see
[`architecture.md`](architecture.md). For the evaluation protocol, see
[`first-eval.md`](first-eval.md).

## What Heval does

It runs the same coding tasks against several models, records every attempt, and
turns those attempts into four things you can show someone: an interactive
chart, a table of the numbers, a static HTML report, and a short video.

One run of many trials is a **job**. Everything downstream reads one job.

## The two pages

Heval serves two separate pages. They are different apps and share no controls.

| URL | What it is |
| --- | --- |
| `/` | Landing page and run launcher. Pick a harness, start a run, watch the terminal stream. |
| `/studio` | Chart studio. Load an exported job and make charts, tables, and the video. |

If you are looking for editing controls, you want `/studio`. There is nothing
editable on `/`.

## The pipeline

Four steps, in order.

**1. A run produces raw output.** Trials land in `jobs/<job-name>/`. This is
whatever the harness wrote — logs, patches, verifier output. Nothing reads it
directly.

**2. `bun run report` normalizes it.** Point it at a job directory:

```bash
bun run report jobs/terminal-bench-comparison
```

That writes three things into `results/harbor/`:

- `<job>.json` — one row per trial, the same shape every view reads
- `<job>.html` — a self-contained static report you can email
- `index.json` — the catalog the studio's job picker lists

**3. The studio loads the normalized JSON.** The job picker at the top reads
`index.json`. Selecting a job fetches that job's `.json`. The URL carries the
job and the chart state, so any view you build is a link.

**4. You export.** Four outputs come off the same job file, so they cannot
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

The composition used to hardcode Merge Gateway's surface, palette, licensed
display face, lockup, and embossed background. All of that now lives in
`src/charts/motion-themes.ts`, one object per theme.

| Theme | What it is |
| --- | --- |
| **Merge Gateway** | The original, and the default. Merge lockup, "Gateway" wordmark, embossed background, FH Oscar Pro headline. |
| **Plain dark** | Unbranded dark. No lockup, no emboss, no licensed face. Reach for this when the chart is not going out as Merge marketing. |
| **Plain light** | The same, on white. |

A theme carries the canvas colour, five ink colours, the two bar colours, a
display and a body font stack, and three switches: whether to embed the
licensed FH Oscar Pro faces, whether to draw the Merge lockup, and the opacity
of the embossed background. The wordmark beside the lockup is a theme value too.

Two things that follow from the switches, rather than being cosmetic:

- **Licensed assets stay with the themes entitled to them.** FH Oscar Pro is
  licensed to Merge, so the plain themes do not embed it, and they never read
  the lockup or the emboss SVG. A plain composition is about 320 kB smaller as
  a result.
- **An unknown theme id falls back to the default** instead of failing, so a
  stale link keeps working.

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
