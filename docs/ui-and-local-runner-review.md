# UI and local evaluation workflow review

Reviewed 2026-09-16. Scope: repository architecture as it affects discovery,
running Harbor evaluations, understanding results, and publishing. Includes
desktop browser inspection, a mobile spot check, code review, and existing
checks. This is not an exhaustive security or statistical-methodology audit.

## Recommendation

Make an experiment the main product object. Give it a visible lifecycle:

**Choose a comparison → check local setup → run → inspect results → export.**

Keep the distinction between editable analysis and frozen published output in
the data model. Replace the top-level Analysis/Presentation split with an
explicit action to create an export from the current view. Ship a thin local
Heval CLI that invokes Harbor and opens the same results UI. A tutorial should
teach that real workflow, with an archived-results path for people who are not
ready to configure a machine or spend model credits.

## What exists today

| Area | Implemented | Missing connection |
| --- | --- | --- |
| Homepage | Illustrated terminal replays and authenticated runs of the older fixture | Harbor experiment selection, setup, and run history |
| Harbor scripts | Job templates, vendor proxy, normalization, reports, comparison verification | One supported install/run/open workflow |
| Studio | Imported/catalog results, saved views, filters, charts, trial details, project bundles | Experiment creation, execution, progress, and direct reproduction |
| Publishing | Social questions, themes, shared renderers, layout checks, images, motion | Clear relationship to the analysis being published |
| Server | Legacy runner API and export APIs | Harbor job lifecycle API |

The existing [architecture document](architecture.md) already assigns task and
trial execution to Harbor. That is the right boundary to implement.

## Findings, in priority order

### 1. There is no end-to-end Harbor journey in the UI — high

The homepage's `RUN REAL` calls `/api/runs` with only a harness. The API invokes
the old worker runner, not Harbor. Studio fetches normalized files from
`/results/harbor/index.json`; it has no Harbor launch path.

A visitor cannot discover the real comparison workflow by following the
product. Signing in does not fill this gap. The landing page emphasizes
watching a demo and early access, although a useful results workbench exists.

Evidence: [homepage](../src/App.tsx), [run API](../server/api.ts),
[Studio](../src/studio/Studio.tsx), [worker launcher](../server/worker/launch.ts).

**Change:** Make “Run your first eval” and “Explore example results” the two
primary entry points. Add “Import Harbor job” and “Run again” within the
experiment workspace. Label the old fixture demonstration separately.

### 2. The default analysis hides the comparison — high

Opening `/studio` loads the six-model comparison, groups by harness, and uses
model as color. All trials use Codex, and the six models exceed the four-series
color policy. The resulting chart is one aggregate Codex bar, accompanied by a
warning telling the user to facet. Observed in the browser.

The static report already chooses model grouping when only one harness exists.
The Studio defaults and artifact's recommended view do not make that choice.

Evidence: [defaults](../src/charts/recipes.ts),
[artifact recommended views](../src/project/schema.ts),
[report sectionsFor](../harbor/report/build-report.ts).

**Change:** Share dataset-aware initial views between report and Studio. For a
single-harness model sweep, group by model with no redundant color encoding.
Show a useful comparison immediately. Keep an explicit URL or saved view's
choices authoritative when restoring it.

### 3. Analysis → Presentation changes the task and can show old data — high

`switchMode` saves analysis, creates a presentation only if none exists, and
always opens Social images. Existing presentations retain their saved analysis
snapshot. This behavior is intentional and covered by tests, but it is difficult
to infer from a mode toggle.

Social images selects a question independently from the analysis chart, so a
user studying cost can land on tasks completed. The sidebar containing the
presentation's analysis-view selector, revision controls, and snapshot count is
hidden on this default tab. “Poster,” “Social images,” and “Motion” also expose
different presentation systems under one umbrella.

Evidence: [switchMode and sidebar](../src/studio/Studio.tsx),
[newPresentation](../src/project/schema.ts),
[social questions](../src/studio/SocialPreview.tsx),
[snapshot tests](../tests/studio.spec.ts).

**Change:** Use “Create export from this view.” Open the current chart with its
metric, filters, sources, and grouping preserved. Offer “Use a social template”
as an explicit choice when its semantics differ. Saved exports display their
source view and a plain-language change indicator. “Update from analysis”
creates a new revision; an existing exported revision stays frozen. Do not
automatically translate unsupported analysis into a different metric.

### 4. The advertised development path breaks publishing — high

The README quick start launches Vite alone. Vite does not proxy the export API.
Opening Social images there produced:

> Failed to execute 'json' on 'Response': Unexpected end of JSON input

The full Bun server with exports enabled successfully reached “Layout checked.
Ready to export.” The publishing browser test mocks the preview route, so it
does not catch this startup-path failure.

Evidence: [Vite config](../vite.config.ts),
[preview fetch](../src/studio/SocialPreview.tsx),
[mocked publishing test](../tests/social-layout.spec.ts).

**Change:** Supply one documented full-workbench startup command. Query
capabilities at startup and show “Start the local export service” with a usable
command if it is absent. Handle non-JSON API failures. Add a real-server
onboarding smoke test rather than relying only on route mocks.

### 5. Run instructions assume the author's machine and expertise — high

- Several job templates use `/Users/mattferoz/.cache/harbor/...` task paths,
  including the README's example validation config.
- The main comparison requires a separately started vendor proxy and uses
  `host.docker.internal:8787`; container-to-host connectivity must be checked on
  each supported platform.
- `.env.example` configures the older runner. Harbor templates additionally
  describe harness-specific credential variables.
- `experiment prepare` generates a config and pins file but does not launch
  Harbor, supervise the proxy, or open results.
- Its default profile is six models × 20 tasks. That is a reproduction workflow,
  not an appropriate first-run tutorial.
- Historical harness versions are checked afterward but not fully provisioned
  by the generated configuration.

Evidence: [job templates](../harbor/jobs/),
[experiment helper](../harbor/experiment.ts),
[reproduction guide](reproducing-evaluations.md), [.env example](../.env.example).

**Change:** Provide a portable starter profile and preflight checks. Use registry
task references or workspace-relative task packages, explicit credentials,
low concurrency, and managed proxy startup. Separate historical reproduction
from starting a new experiment with currently supported versions.

### 6. Expert controls precede the user's question — medium

Studio exposes Project/Bundle, saved views, recipe, grouping, color, facet,
aggregation, and spec editing before establishing what the user wants to learn.
On a 393-pixel mobile viewport, the sidebar stacks above the results and fills
the initial screen. No document-level horizontal overflow was observed, but
the result itself is below a long block of controls.

**Change:** Put the result summary and question first. Offer “Which completes
more?”, “What does it cost?”, “How long does it take?”, and “Where did it fail?”
Move encoding/spec controls into “Customize chart.” On mobile, use a collapsed
controls panel. Explain “Save workspace” versus “Download workspace with data”
instead of requiring users to understand Project and Bundle.

### 7. Result discovery is tied to repository builds — medium

Vite copies `results/` to `dist/results` at build time. The Bun server serves
that copy. Normalizing another job into the source tree after building does
not automatically update the served catalog. A local CLI needs a runtime data
directory and a live job catalog independent of bundled UI assets.

Evidence: [build copy](../vite.config.ts), [static server](../server/index.ts).

## Proposed product flow

Navigation: **Experiments · Learn · Settings**.

An experiment page has **Setup · Runs · Results · Exports**. These are available
sections, not a wizard users must repeat before examining existing data.

1. **Choose:** Start with “Try one task,” “Compare models,” “Compare harnesses,”
   or “Import existing results.” Show archived examples as immediately usable.
2. **Configure:** Select dataset/tasks, model, harness, attempts, and concurrency.
   Show the expanded trial count. Keep provider/vendor routing visible where it
   affects interpretation. Offer the exact Harbor config under “View config.”
3. **Check:** Explain what runs locally. Check the Harbor version, Docker daemon,
   resources, credential presence, selected route, and container connectivity.
   Do not display a precise cost promise when token use or prices are unknown.
4. **Run:** Show setup, queued, running, grading, completed, and infrastructure
   errors separately. Offer logs, cancellation, and supported resume/retry.
   Preserve the failed attempt and configuration when making a retry.
5. **Understand:** Open a useful comparison and let users drill into failed
   trials and available evidence. “Run again with changes” copies the setup into
   a new run rather than overwriting historical results.
6. **Export:** Create an image/report from the current view. Saved exports retain
   immutable input references and an explicit revision history.

The vocabulary should be introduced in context: an experiment is a comparison
definition, a run executes it, and a trial is one agent attempting one task.

## Tutorial design

Build two short paths, both ending in inspecting evidence and exporting a view.

**Explore without setup:** Open an archived comparison → answer a completion
question → inspect one failed trial → inspect cost coverage → export a chart.
No account, Docker, or model credentials are needed to inspect archived data.
Image export still needs the rendering capability supplied by the product.

**Run on your machine:** Install the supported runner → run preflight → configure
one provider → select one small task, one model, one harness, one attempt, and
concurrency one → review → launch → watch progress → inspect the grader result
→ export. Explain that this proves the workflow, not model superiority.

Only then offer adding a second model and expanding the task set. Do not make
the six-model historical comparison the first exercise.

Each step needs a purpose, one action, an observable success condition, and a
recovery instruction. A walkthrough should detect a completed preflight or run,
not merely advance through tooltip clicks. Let experienced users skip it.

For the immediate documentation bridge, the existing sequence is prepare,
validate config, configure credentials/proxy, invoke Harbor, normalize with
`bun run report`, verify when reproducing a saved comparison, then open Studio.
The reproduction guide should spell out the currently missing middle steps.
Do not present this manual sequence as a finished cross-platform installer.

## Installable CLI plan

Harbor already supplies installation and evaluation commands; Heval should
orchestrate those capabilities and contribute the experiment/result experience.
See Harbor's [getting started](https://www.harborframework.com/docs/getting-started)
and [job configuration](https://www.harborframework.com/docs/core-concepts).
Those are current upstream docs; this repository pins Harbor 0.22.0, so validate
the adapter against that version before adopting newer command flags.

The following is a proposed interface, not commands that exist today:

```sh
heval doctor
heval init --template first-eval
heval run --config heval.yaml --dry-run
heval run --config heval.yaml
heval status <run-id>
heval open <run-id>
heval import ./jobs/existing-harbor-job
heval export <run-id> --format html
```

`heval run` should validate the plan, invoke the supported Harbor executable,
manage any required routing proxy, preserve raw output, normalize results, and
print a local results URL. `heval open` serves the packaged UI against the local
data directory. Launching an eval must not depend on a WorkOS account for a
single-user local install. Keep authentication on the existing authenticated
server path; do not simply remove its checks.

A minimal runtime boundary:

```text
CLI / local UI → Heval run service → Harbor subprocess → Docker
                       ↓
              run metadata + raw artifacts
                       ↓
              normalization → results UI → exports
```

Package a dedicated CLI with a `bin` entry and a prebuilt UI; keep the first
release Bun-based to reuse existing code. State the Bun/Harbor/Docker
prerequisites explicitly. The root package is currently private and has no
`bin`; making an npm package requires packaging work, not just an install line.
Choose and verify package-name availability before documenting installation.
Standalone executables can follow once asset resolution and platform testing
are settled; they would not eliminate Harbor and Docker requirements.

Separate install assets from workspace data and support running outside the
repository. Keep Chromium/Node image rendering and motion dependencies optional
for users who only need evaluation and HTML/data results. The experiment helper
currently imports the poster renderer even for prepare/verify; split that
dependency before making the runner installable.

Persist run state across restarts. Store the submitted config, resolved task
checksums, observed harness/tool versions, environment metadata, relevant price
snapshot, raw artifact locations, and normalized artifact hashes. Never include
credential values in a shareable manifest. Pin what can be pinned and describe
the remaining reproducibility limits.

For a hosted website, start with downloadable config plus a local CLI command,
then import the resulting bundle. A hosted browser cannot directly execute
Docker on the visitor's machine. A future live local companion connection needs
deliberate pairing and origin/token checks; it is a separate integration.

## Suggested implementation order and acceptance criteria

| Slice | Work | Done when |
| --- | --- | --- |
| 1. Make results understandable | Dataset-aware defaults, result-first mobile layout, explicit export handoff, API capability state | Fresh Studio shows the six-model comparison; publishing errors explain the needed setup; users can identify which view an export uses |
| 2. Complete one local run | Portable starter profile, doctor/init/run/open, Harbor adapter, persistent run catalog | A fresh supported machine completes one task and opens its result without editing source files or rebuilding the frontend |
| 3. Teach and distribute | Guided first-eval path, packaged CLI/UI, installation docs | Install from a packed release outside the repo; follow the tutorial through a real run; export a result |
| 4. Expand workflows | Multi-model setup, rerun/diff, resume, imported raw jobs, optional hosted handoff | Failures and retries retain lineage; archived and new runs remain distinguishable |

Keep the shared chart/metric functions, snapshot hashes, null-cost handling,
cohort validation, and layout checks. These are useful foundations. Extract
experiment setup, results exploration, and export editing from the 986-line
Studio component as their workflows change; splitting files alone will not
solve discoverability.

## Verification performed

- Frozen-lockfile dependency installation succeeded.
- Production build passed, with a Studio bundle-size warning.
- Project/chart tests: 22 passed.
- Server tests: 19 passed; the Docker integration test was skipped.
- Desktop Chromium suite: 28 passed, one mobile-only navigation test skipped.
- Browser walkthrough: homepage, default Studio, Vite publishing failure, full
  Bun publishing preview success, and 393-pixel mobile analysis layout.
- Lint failed on four existing `no-explicit-any` errors in
  `tests/social-layout.spec.ts` (lines 18, 32, 39, 48).

No paid model calls or Docker evaluations were launched. Harbor is not installed
in this review environment, so execution portability and the pinned upstream
adapter remain unverified. Product code was not changed by this review.
