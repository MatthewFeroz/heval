# Extensible social charts

Status: static social presets implemented, 2026-09-08. Studio supports all six reference presets plus completion rate, saved settings, PNG and thread ZIP exports. The four-image thread has been generated from the audited data.

## Outcome

Select evaluation data in Studio, choose a reusable social chart preset, preview it in the Merge Gateway theme, and export an individual image or a collection. A new metric should not need its own renderer, API route, or editor screen. A new layout should not recompute statistics.

The first collection contains four images: Tasks completed; Total task cost; Median time per completed task; Tasks over 5 minutes, including timeouts. Keep the existing completion-rate and cost-per-success presets available. Use the user's Heval data, actual model versions, and source label "Merge Evaluations". Keep the recent social defaults: no collection headline and no trial-count subtitle. Metric-specific headings and short definitions still convey what each graph measures.

## Reference and evidence

- Requested reference: https://x.com/composio/status/2092983285819310307
- Opening post and overview photo retrieved through the public FxTwitter API on 2026-09-08 after direct X access failed. It describes five models evaluated on 30 multi-step tasks. Its overview shows completion rate, cost per success, and median time.
- The user supplied all six individual reference images after the initial review. Their layouts are now verified below. Reference values remain Composio data; export values come from Heval.
- Merge palette source already reviewed: plugin/merge-marketing/skills/weekly-model-benchmark-graphic/{SKILL.md,tokens.css,build.py} in https://github.com/merge-api/merge-skills . Dark canvas and inverse type follow plugin/merge-marketing/SHARED.md.
- Local audit: [social-chart-data-audit.json](social-chart-data-audit.json).

## What the local data actually supports

The normalized export results/harbor/terminal-bench-composio-mirror.json has 120 trials across six models, all Codex 0.152.1. The five models used for the existing social image have 100 trials: one attempt on each of the same 20 task IDs per model. All rows have recorded durations, task checksums and costs. Costs are token-derived, not provider invoice totals. Serving vendors differ across models and must travel in provenance.

The file terminal-bench-glm53-flash-30.json has four trials across two tasks and two harnesses. Its filename is not evidence of 30 completed task attempts. No raw jobs are present locally in jobs/; the normalized export points to the original Mac workspace. There is no complete five-model, 30-task dataset in the local catalog.

| Model | Completed | Total task cost | Median passed time | Slow, no timeout | Timeouts | Slow including timeouts |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| GLM 5.3 | 14/20 | $4.4310 | 170.38s | 4 | 1 | 5 |
| GLM 5.3 Flash | 9/20 | $0.07868 | 111.10s | 4 | 2 | 6 |
| Kimi K3 | 10/20 | $7.0157 | 165.27s | 4 | 2 | 6 |
| DeepSeek V4 Flash | 12/20 | $0.38674 | 261.11s | 6 | 4 | 10 |
| DeepSeek V4 Pro 0813 | 11/20 | $8.4658 | 140.75s | 4 | 3 | 7 |

These are Heval results, not Composio's numbers. Titles derive the task count: "Cost across 20 tasks" now, and "Cost across 30 tasks" only when a selected comparable dataset contains 30 tasks per model. Do not scale the 20-task spend to imply a measured 30-task total.

## Current friction

1. src/charts/metrics.ts already centralizes completionRate, costPerSuccess and medianTimePassed. However, report-specific sums and slow/timeout counts still live in harbor/report/build-report.ts. Derived values also reach Vega through collapseTo synthetic trial rows, which inherit unrelated fields from the first real trial.
2. src/charts/poster.ts hard-codes three PanelIds and a scalar value per bar. It has no horizontal layout or disagreement-matrix presentation. harbor/report/build-poster.ts mixes argument parsing, input selection, branding, HTML layout and rendering orchestration. The latest comparison variants are package.json command strings, not saved Studio presentations.
3. src/studio/MotionPreview.tsx and harbor/social/completion.ts reference PANELS.completion directly. Labels, axes, filenames and availability messages all assume completion. server/social-api.ts and server/social-export.ts route presentations through CompletionOptions and completionComposition.
4. src/project/schema.ts already provides useful EvaluationArtifact, AnalysisView, Presentation, source pins, hashes and bundle support. Presentation nevertheless has a mandatory completion-specific motion field. Extend this existing model; do not create an unrelated poster project format.
5. Branding is duplicated in poster.ts, motion-themes.ts and palette.ts. The static poster now uses official weekly colors, while the motion Merge theme still contains the earlier blue/gray pair. Copying those modules will perpetuate drift.
6. harbor/report/trials.ts classifies any error containing "timeout" as an agent timeout, and marks all such errors slow. A setup or verifier timeout could therefore be mislabeled in future imports. Missing timestamps currently become overSlow=0 unless an error indicates timeout. Preserve unknowns and distinguish phases before claiming general timeout support.

## Target arrangement

Evaluation artifacts + saved selection
  -> cohort validation and metric evaluation
  -> resolved chart values, units, coverage and provenance
  -> selected layout + selected brand theme
  -> shared HTML/SVG document
  -> Studio preview, PNG export, batch export

Keep ordinary exploratory Vega charts. Both that path and social layouts consume the same resolved metric results. Reuse the existing Node/Chromium screenshot worker for PNG. Keep Hyperframes/GSAP for animation later; PNG should not require a completion animation.

### Metric module

Each metric defines its identity, label, unit, direction, required fields, filtering, aggregation, missing-data policy and valid visual forms. Return values together with denominators, eligible-record counts and coverage. Renderers receive these resolved results; they do not infer eligibility or perform arithmetic.

Initial metrics:

| Preset | Computation | Eligibility and display |
| --- | --- | --- |
| Tasks completed | Number of passed trials in the selected single-attempt cohort | Label 14/20; integer ticks; zero baseline. Multiple attempts require a separately named policy, not a silent count of unique tasks with any success. |
| Completion rate | Passed trials / selected eligible trials | Existing behavior retained; zero to 100%. |
| Total task cost | Sum costUsd across all selected attempts, including failed and timed-out attempts | Require complete pricing for an unqualified total; unknown cost is not zero. Preserve derived/reported pricing metadata. |
| Cost per success | Total task cost / passed count | Separate from total cost; no passes gives unavailable, not free. |
| Median time per completed task | Median agentSeconds among passed attempts | Exclude failures and timeout caps. Missing successful durations produce an explicit coverage warning or unavailable result in the strict social preset. |
| Tasks over 5 minutes | Count agent execution >300s OR agent timeout, following the existing inclusive convention | Left panel: inclusive slow count. Right panel: agent timeout count, a subset. Panels are not added or stacked. Exactly 300s without timeout is not >300s. Unknown timing is not fast. |

Use the common metric field semantics already declared by EvaluationArtifact. Validate cost fields even when the current analysis measure is passed. Require compatible dataset/task versions and the same selected task set for direct total comparisons. Group by stack when more than one harness is selected; never silently pool different harnesses or runs under a model name.

For repeated attempts, first ship a clearly labeled trial-count view and prevent it from claiming unique task completions. Later add named policies such as first attempt, per-task average success, or any-success across k attempts, each with explicit semantics. Source hashes, run IDs and task checksums must distinguish actual retries from duplicated imports.

### Layout module

Support vertical bars, horizontal bars, paired vertical panels and a task-outcome matrix. Add a collection layout that places the same resolved charts into a row or a 2-by-2 grid without re-aggregating them. Four separate images are the confirmed thread default; a combined image remains an optional later export.

Axes and value labels derive from units: counts never use percent formatting; low dollar values retain enough precision to avoid $0.00; seconds and minutes convert together for axis and values. Zero bars remain visible through their labels; unavailable values use an explicit N/A treatment and are not silently shifted out of shared model positions.

Support fixed model order and explicit ascending/descending value order. Reference single charts sort descending by value, even for cost and time where lower is better. The paired slow/timeout chart sorts by slow count and shares that order across both panels. Sorting is distinct from highlight selection. For ordinary metric bars, lilac highlights the best value for that metric, including ties; other bars use official robin/sage/teal/khaki/charcoal tokens at full opacity. The paired slow/timeout layout uses separate labeled panels, not stacked colors. Lilac may mark the metric minimum including all ties; zero values retain visible labels. Matrix cells use consistent pass/fail/unknown tokens and symbols, independent of model colors.

### Brand and copy module

Centralize a versioned Merge theme with the actual logo, Gateway wordmark, embedded FH Oscar Pro, Inter, charcoal canvas and ivory/tan text. Reference the upstream skill paths and reviewed revision alongside vendored tokens. Preserve a dark comparison theme separately from the weekly skill's light leaderboard layout.

Save title, sample subtitle, direction cue, definition note, footer and source visibility as explicit fields. An intentionally hidden title must survive save/reload; empty text must not fall back to a default heading. Source defaults to Merge Evaluations. Keep captions and data/provenance exports available so methodological detail does not need to crowd every social image.

### Studio and saved projects

The user flow is: select data/models, choose a preset, choose layout and canvas, edit visible copy, preview, export PNG or all images. Show only controls relevant to the chosen preset. Disable unavailable metrics with a concrete reason, such as missing successful-run durations or incomplete pricing.

Extend Presentation with metric/layout/collection selection and versioned settings. Keep existing source pins, revisions, analysis snapshots, custom specs, project bundles and undo history. Migrate old completion presentations to an explicit completion-rate preset while preserving theme, axis and label overrides. Do not reinterpret old saved documents when defaults change.

## Delivery sequence and acceptance checks

1. Metric foundation and data validation. Move the required arithmetic into the shared metric module; add coverage and cohort validation; classify timeouts by phase with legacy unknown fallback. Verify the table above from the checked-in input. Test missing prices, no passes, unknown durations, threshold boundary, timeouts, repeated attempts, mixed harnesses and duplicate input.
2. Reusable static social renderer. Extract renderable markup from the poster CLI, add the four default presets plus optional cost-per-success and disagreement-matrix presets, centralize Merge tokens. A small collection definition should generate all images with one command. Preview HTML and PNG use the same document. Test geometry for tiny costs, zeros, long labels and six models; inspect rendered images at mobile-readable size.
3. Studio integration. Add preset/layout/visibility controls and static export to the existing Presentation flow. Extend API parsing to validate the new settings and each metric's required fields. Save, reload, duplicate, undo and bundle round-trip must preserve identical values and visible text. Retain completion MP4 exports during migration.
4. Batch export and reproducibility. Export individual PNGs plus an optional contact sheet/combined image, plotted-values CSV and manifest containing source hashes, filters, metric definitions, renderer/theme versions and task coverage. Use asynchronous bounded rendering through the existing server capacity guard; no synchronous process spawn in an HTTP request handler. Errors clean up per-request scratch files. Subsequent datasets should need data selection, not TypeScript or package.json edits.
5. Optional animation expansion after static parity. Generalize the completion animation to consume resolved chart data for supported layouts. Preserve the final static frame and metric values across PNG/MP4 exports. Animation does not block delivery of the requested social images.

First end-to-end acceptance case: select the existing five-model data in Studio, choose the evaluation-thread collection, leave title/subtitle hidden, export four Merge-branded images with the exact Heval table values above, then reload a saved presentation and reproduce them. Change to a verified 30-task cohort and see task-count labels update automatically.

## Scope and open inputs

No new evaluations, provider requests, model spending, deployments or social posting are part of this plan. A local missing 30-task dataset is a data availability issue, not a rendering feature.

All six follow-up reference images are supplied. Reproduce their chart structures using Heval values and the approved Merge styling. The reference imagery does not establish whether its slow count includes timeouts; the Heval inclusive policy must remain explicit. The user confirmed four separate images for a thread as the default.

The useful first change is the four static presets through a shared metric-to-render pipeline. A general plugin marketplace, arbitrary executable formulas and a new runner architecture do not help that first deliverable and are deferred.

## Confirmed reference layouts

| Preset | Layout | Reference ordering | Default thread |
| --- | --- | --- | --- |
| Tasks completed | Vertical bars; count labels above; integer y-axis capped at eligible task count | Completed count descending | Yes |
| Cost per successful task | Horizontal bars; dollar values outside bar ends | Cost per success descending | Optional |
| Total task cost | Horizontal bars; dollar values outside bar ends | Total cost descending | Yes |
| Median time per completed task | Horizontal bars; second values outside bar ends | Median time descending | Yes |
| Tasks over 5 minutes / timeouts | Two vertical panels; independent integer scales; visible zero labels | Slow count descending, same model order in both panels | Yes |
| Tasks where models differed | Task rows by model columns; pass/fail symbols; only differing outcomes | Fixed model columns, stable task order | Optional |

The paired timeout image replaces the initially proposed stacked chart. The two counts overlap under Heval's existing convention and must never be summed. The left scale follows slow counts and the right follows timeout counts; both start at zero and use integers. Preserve enough plot headroom for labels.

For the disagreement matrix, align by dataset version and task checksum within the selected cohort. Require one selected attempt per model/task for binary outcomes. A missing observation is unknown, not fail; incomplete task rows must be reported separately and must not enter all-passed/all-failed totals. A display-name collision is not a valid task join. Repeated attempts require an explicit policy or a separately labeled pass-rate matrix. Paginate long matrices with repeated headings and a consistent cell size instead of shrinking text indefinitely.

The current five-model data has **15 differing tasks, 3 passed by all models, 2 failed by all models, and 0 incomplete task rows** by task ID. Verify matching checksums before implementing the matrix join. Its title must derive these counts; do not copy the reference's 11/14/5 counts. Store the summary with the resolved chart so subtitle counts cannot drift from plotted rows.

Keep the Merge logo, FH Oscar Pro/Inter typography, charcoal canvas, approved weekly palette and Merge Evaluations source. Do not copy Composio's neon colors, orange, monospace typography or letter-spaced uppercase. Solid fills remain the Merge default; the reference's dot texture is decorative and not required for structural matching. Keep direction labels and data-count subtitles optional as already requested.

The six examples need four layout families, not six independent renderers. Presets select a metric, layout, sort rule and copy defaults. A saved collection selects which presets to export. This is the primary extensibility requirement now demonstrated by actual references.

## Implementation delivery notes

Implemented landscape SVG/PNG layouts, a shared metric resolver, task-cohort validation, pinned presentation settings, tab-local undo/redo, a shared export-capacity lock, a portable thread CLI, and ZIP manifests carrying the exact selected input. Missing/repeated task observations are rejected for the single-attempt presets. The matrix paginates at 12 rows. Existing completion motion rendering remains available and now shares the official Merge color constants.

Optional later work: square/portrait layouts for these new presets, combined contact sheets, animated variants beyond completion, arbitrary field-defined custom metrics, and named repeated-attempt aggregation policies. These are not needed for the six supplied landscape reference layouts.

### Publishing without a setup wizard

Open results to see the analysis immediately. Presentation opens Social images with a ready-made question and the Merge Gateway dark theme. Choose a different question or style, then export an image or the default four-image thread. Models, source text, optional captions, and thread contents live under **Customize models, text and thread**. Poster and Motion remain available for advanced editing. Returning to Analysis preserves the saved comparison.

Publishing themes are registered in `src/charts/social-themes.ts`; questions and metric definitions are in `src/charts/social-presets.ts`. Saved social settings include the theme; older settings default to Merge dark. The light and dark Merge themes share the weekly benchmark palette, Oscar/Inter fonts, and Gateway lockup. Plain report omits the logo.

Preview and PNG export run the same font-aware SVG layout checks in `harbor/report/layout-check.js`. Labels shrink only to a defined minimum; long names can be abbreviated, with adjustments shown in the editor and complete names retained in the data. Numeric values are never truncated. Unresolved overlap or clipping blocks export. Every page of a thread is checked during rendering. These checks cover the fixed 1600x900 layouts with up to six models; they do not guarantee legibility at every social platform's thumbnail size.
