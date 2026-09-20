# Heval

Heval is a local-first evaluation workbench for comparing coding-agent stacks on the same task, environment, model, and budget.

It captures terminal trajectories, grades the resulting workspace with executable tests, and presents synchronized side-by-side replays for Claude Code, Codex, OpenCode, and Pi.

![Heval home screen](docs/images/home.png)

> [!NOTE]
> Heval is an early prototype. The landing page includes development fixtures; [`results/`](results/) also contains exploratory evaluation snapshots. These small comparisons are not a general model leaderboard.

## Features

- Hosted report import, private cloud storage, anonymous share links, and revocation
- Four synchronized coding-agent lanes with pinned harness and model metadata
- Replay controls with time, token, cost, and pass/fail displays
- An opt-in Bun control plane for launching isolated local evaluations
- Live ANSI terminal streaming over WebSockets
- Timestamped local recordings and executable grading
- Responsive desktop and mobile interfaces
- Playwright coverage for primary interactions

## Current Evaluation

The first task, `concurrent-cache-v1`, asks each agent to repair a race condition in an asynchronous TypeScript cache without changing its public API. The same fixture and executable grader are used for every harness.

The latest smoke snapshot records one passing attempt for each harness against `anthropic/claude-sonnet-4-5-20250929` through Merge Gateway:

| Harness | Version | Result | Duration |
| --- | ---: | :---: | ---: |
| Codex | 0.151.0 | Pass | 31.9s |
| Pi | 0.84.4 | Pass | 38.6s |
| Claude Code | 2.1.251 | Pass | 39.7s |
| OpenCode | 1.18.25 | Pass | 44.4s |

See [`results/concurrent-cache-v1-current.json`](results/concurrent-cache-v1-current.json) for the machine-readable snapshot and [`docs/first-eval.md`](docs/first-eval.md) for the protocol and limitations.

## Quick Start

### Hosted reports

Open [Your reports](https://temporary-rushing-violet-xu17m97.vercel.app/reports), sign in, and import a normalized Harbor JSON export. Review it, save privately, then create or revoke a share link. No local server is needed to view a shared report.

See the [user walkthrough and recording](docs/hosted-reports.md) for the complete flow, supported files, limits, and deployment setup.

### Connected Harbor runners (preview)

The `main` branch connects the browser workspace to
a Linux machine or cloud VM using an outbound runner. Queue a setup check,
monitor it from another browser, and open the automatically saved report.
The preview includes content-pinned local profiles, durable claims, cancellation,
and daemon-restart recovery. It does not provision VMs or migrate live containers.

See [installation, workflow, and limits](docs/connected-runners.md). The published
0.1.0 CLI remains a local viewer; build the preview tarball for runner commands.

### Installable local results viewer

The CLI is available on npm as [`@mattferoz/heval`](https://www.npmjs.com/package/@mattferoz/heval).
It provides `heval doctor` and `heval open` for example results, normalized JSON,
or raw Harbor job directories. The installed viewer requires Node.js 22+, with
no Bun, Docker, or account needed to explore existing data.

Open the bundled example:

```sh
npx @mattferoz/heval@latest open
```

Or install it with `npm install -g @mattferoz/heval`, then use `heval open`.
See the [CLI guide](packages/cli/README.md) for local builds and
[Publishing the CLI](docs/publishing-cli.md) for the release procedure.
This release does not launch evaluations; execute a Harbor job, then open its
results with `heval open ./jobs/your-job`.

### Requirements

- [Bun](https://bun.sh/) 1.4 or newer
- A Chromium-compatible browser
- [Harbor](https://pypi.org/project/harbor/) 0.23.0 and Docker, for Harbor-based evaluations (`uv tool install harbor==0.23.0`)

```bash
git clone https://github.com/MatthewFeroz/heval.git
cd heval
bun install
bun run dev
```

Open `http://localhost:5173`.

For the full development app, also run `bun run serve` after an initial
`bun run build`. Vite forwards `/api` requests to the Bun server on port 4173.
Alternatively, `bun run start` builds and serves the complete app on port 4173.

### Deployment targets

The consolidated repository supports three entry points:

| Target | Build | Capabilities |
| --- | --- | --- |
| Vercel + Convex | `bun scripts/vercel-build.ts` (configured in `vercel.json`) | Persistent private reports and revocable sharing, published results, Studio, browser exports; no cloud runner |
| Bun application | `bun run build`, then `bun run serve` | Workbench, authenticated run history, provider connections and optional server exports |
| Invited hosted Bun deployment | `bun run build:public` | Uses only the explicitly published catalog; requires persistent storage and the configuration in [deployment.md](docs/deployment.md) |

The npm CLI remains a separate Node-only results viewer. The hosted report
workspace uses Convex and the existing WorkOS sign-in. See [hosted reports](docs/hosted-reports.md)
for its storage, access rules, and deployment instructions.

## Authentication

The public showcase works without configuration. WorkOS AuthKit sign-in gates the hosted Studio page and real evaluation controls. Studio waits for session verification before loading either editor, preserves the requested URL through sign-in, and stays closed if authentication is unconfigured. The Bun server verifies every runner access token against WorkOS's JWKS. The CLI's local results viewer remains account-free.

1. In the WorkOS Dashboard, copy your environment's client ID into both `VITE_WORKOS_CLIENT_ID` and `WORKOS_CLIENT_ID` in `.env.local` (start from `.env.example`). The client ID is public; no WorkOS API key is used by this integration.
2. Add `http://localhost:5173` as an allowed web origin and sign-in callback redirect URI.
3. Add `http://localhost:5173/login` as the Sign-in URL.
4. For the hosted app, add its exact HTTPS origin and root callback in the same places, plus `<origin>/login` as its Sign-in URL.
5. If using a custom Authentication API domain, set `VITE_WORKOS_API_HOSTNAME` and `WORKOS_API_HOSTNAME` to the hostname only (for example, `auth.example.com`). Otherwise leave the browser value empty and keep the server value at `api.workos.com`.

Without a custom Authentication API domain, Heval enables AuthKit's browser-persisted staging session so sign-in survives navigation and reloads on Vercel. A same-site custom Authentication API domain uses HttpOnly-cookie sessions instead. See [WorkOS's session configuration](https://github.com/workos/authkit-react#authkitprovider-). Homepage and `/login` sign-ins open Studio; report/chart deep links keep their destination. Cloud reports belong to the signed-in account; use **Save private report** and **Save draft** to persist data and edits.

Signed-in accounts with no getting-started progress see a skippable CLI walkthrough before their workspace opens. It covers the published demo, prerequisites, Harbor execution, and saving results. Convex stores progress per account, including skips and completion; **CLI guide** in Studio reopens it. See the [flow plan](docs/plans/first-login-cli-guide.md). Validate with `bun run test:onboarding`, `bun run test:reports`, and the onboarding Playwright tests.

Set `HEVAL_ENABLE_RUNNER=1` only where real harness execution should be allowed. Browser evaluators connect their own key in **Provider settings**. Saved keys are encrypted server-side; workers receive temporary proxy tokens. Never use a `VITE_` prefix for secrets. See [provider connections](docs/provider-connections.md).

## Commands

| Command | Purpose |
| --- | --- |
| `bun run dev` | Start the Vite development server |
| `bun run build` | Type-check and create a production build |
| `bun run serve` | Serve the built app and local runner API |
| `bun run start` | Build, then start the Bun server |
| `bun run lint` | Run ESLint |
| `bun run test:e2e` | Run desktop and mobile Playwright tests |
| `bun run test:deployments` | Build and browser-test the Vercel showcase and public Bun app (leaves `dist` as the public build) |
| `bun run report <job-dir>` | Normalize a Harbor job into `results/harbor/` and build its static report |
| `bun run poster <job.json>` | Export one Merge-branded social PNG per headline graph |

Install Playwright's browser once before running end-to-end tests locally:

```bash
bunx playwright install chromium
```

## Running Real Evaluations

To run evaluations on a separate Linux PC while keeping the app on your Mac, follow the [Linux worker setup](docs/linux-worker.md). It includes Ubuntu, Docker, private networking and SSH commands.

Real harness execution is disabled by default because agents run with broad permissions inside disposable fixture workspaces. For a new checkout, copy the example configuration and provide the WorkOS client ID. Preserve an existing `.env.local`:

```bash
cp .env.example .env.local
```

```dotenv
VITE_WORKOS_CLIENT_ID=client_replace_me
WORKOS_CLIENT_ID=client_replace_me
HEVAL_ENABLE_RUNNER=1
HOST=0.0.0.0
HEVAL_GATEWAY_MODEL=anthropic/claude-sonnet-4-5-20250929
PORT=4173
```

Start the full application. Bun loads `.env.local` automatically:

```bash
bun run start
```

Before enabling execution, install Docker Desktop (Linux containers) or Docker Engine and build the worker image:

```bash
bun run worker:build
```

The runner launches each attempt as a non-root Docker worker with a read-only root filesystem, dropped capabilities, no host bind mounts, and CPU, memory, process and wall-clock limits. Each browser evaluation receives a separate Docker volume and a temporary inference token restricted to its chosen model. After signing in, open **Provider settings**, choose Merge Gateway, and **Validate and connect** your key before launching. Agent execution still has outbound network access. Host processes never execute the agent or its changed code.

After an agent exits successfully, a fresh networkless container grades the candidate using the pinned fixture tests. For this task, only `src/cache.ts` is copied into the grader. The agent cannot replace the grader's test file. Grading is automatic; the grade endpoint returns the completed result or HTTP 409 while unavailable.

All run endpoints, including listing and WebSocket upgrades, require a verified WorkOS token with a user subject. Runs belong to that user; requests for another user's run return 404. Lists omit transcripts; owners can retrieve them from the individual run endpoint.

Defaults allow two active evaluations globally, one per user, five minutes per agent, 30 seconds per grader, and 8 MiB of output. Capacity includes grading and cleanup. See `.env.example` for overrides. Cancellation and timeout remove the worker container; completion removes both containers and the workspace volume. A cleanup failure blocks new runs until the operator checks Docker resources and restarts the server. Container-side maximum timeouts also stop execution if the server crashes; abandoned volumes may still need operator cleanup.

Recordings use ordered `<run-id>.jsonl` events plus an atomically replaced `<run-id>.json` summary every second and on completion. Summaries omit terminal chunks. Writes are asynchronous and append only new events. A crash may lose the last unflushed second of output. The configured gateway key is redacted from streamed and recorded output, including when split between chunks. Encoded or transformed secrets are not covered by that redaction.

Run summaries and owner identities are restored from disk on startup. Interrupted workers are cleaned up and their runs are marked failed with a restart reason. Completed transcripts are loaded from disk on demand. Daily per-user attempt limits survive restarts. Set `HEVAL_DATA_DIR` to persistent storage for hosted use. This remains a single-process scheduler.

```bash
bun run test:server
bun run test:docker
```

The Docker smoke test uses no model credits and checks isolation and immutable grading. It requires a running Linux Docker engine. On Windows, finish any requested WSL restart before running it. The HTTP server binds to `127.0.0.1` by default; `HOST` can override it.

For public hosting with invited evaluators, use the separate web/worker deployment in [docs/deployment.md](docs/deployment.md). Keep the Bun port behind its HTTPS proxy. Do not expose the default local runner directly.

## Architecture

New to the codebase? [`docs/how-it-works.md`](docs/how-it-works.md) walks through
the two pages, the job pipeline, and which controls live in the UI versus the code.

```text
React + Vite replay UI
          |
          v
Bun API + WebSockets
          |
          v
Disposable harness workspace
          |
          v
Executable fixture grader
```

The planned production boundary uses Harbor for portable evaluation execution, a replaceable sandbox provider, and object storage for trajectories and artifacts. See [`docs/architecture.md`](docs/architecture.md).

Harbor is now pinned and installed rather than planned. [`harbor/toolchain.json`](harbor/toolchain.json)
records the runner, sandbox, and harness versions; [`harbor/jobs/`](harbor/jobs/) holds job
configurations. Validate one without spending anything:

```bash
harbor run -c harbor/jobs/terminal-bench-codex-vs-claude.yaml --print-config
```

The Bun control plane in [`server/`](server/) predates this and duplicates much of what Harbor owns
(workspace isolation, harness configuration, grading, trial accounting). It remains the path the
published `concurrent-cache-v1` snapshots were produced with.

### Reading a job: report and chart studio

A finished Harbor job is a directory of per-trial `config.json` / `result.json` files. One command
turns it into a normalized export plus a self-contained report:

```bash
bun run report jobs/terminal-bench-glm53-smoke
```

That writes three things under `results/harbor/`:

| File | Contents |
| --- | --- |
| `<job>.json` | Normalized `TrialRow[]` - one row per trial, the shape every chart reads |
| `<job>.html` | Static report: four charts rendered to SVG in both themes, stat tiles, auto-detected limitations, per-trial table, provenance footer |
| `index.json` | Catalog of exported jobs, read by the studio's job picker |

The **chart studio** at `/studio` (`bun run dev`, then <http://localhost:5173/studio>) is the same
charts, configurable. Pick a job, change the recipe, encodings, measure, aggregate, sort, labels and
theme, and export SVG or PNG. The state lives in the URL, so every chart in the report links to the
studio already configured, and a studio link can be pasted back to someone else. You can also drop a
`<job>.json` export onto the page to inspect a run that was never committed.

Both surfaces call `buildChart` from [`src/charts/recipes.ts`](src/charts/recipes.ts) - the report
compiles the spec headlessly, the studio renders it with `vega-embed` - so a chart cannot look one
way in the editor and another in the published report. The recipes also enforce the presentation
rules: at most four categorical series (past that, color is dropped and the user is told to facet),
Wilson 95% intervals on pass rates, a legend plus direct labels plus a table view so identity never
rides on color alone, and light/dark palettes validated independently against their own surface.

Charts do not hide the data's problems. A trial the gateway priced at `null`, a stack that ran with
no prompt caching, fewer than three trials per cell, or a single task all surface as warnings in the
studio and as a "Limitations" list in the report.

### Exporting social graphs

The poster exporter turns a normalized job into separate square PNGs for completion rate, cost per
success, and median time. Each image includes its title, sample size, model labels, values, and source
line, so it can stand on its own outside the report.

```bash
bun run poster results/harbor/terminal-bench-comparison.json --open-weight
```

The command writes 2400x2400 PNGs and editable HTML files under
`results/harbor/posters/<job>/`. Use `--panels completion,cost-per-success` to choose graphs,
`--models <model-a>,<model-b>` to set the field and color order, or `--combined` to also export a
three-panel 3200x1800 image. Run `bun run poster --help` for the full option list.

`--brand-right` sets the title and the Gateway lockup on one line, headline left and lockup right.
Under `--designer`, `--logo-spot` decides where each model's mark sits: `axis-inline` beside the model
name, `axis-below` under it, `above-bar` stacked over the value label, or `in-bar` inside the bar under
the value label. A bar too short to hold its own mark falls back to `above-bar` for that column.

## Repository Layout

```text
fixtures/         Pinned benchmark tasks and graders
harbor/           Pinned eval toolchain, Harbor job configs, report builder
jobs/             Raw Harbor job output (gitignored - large, per-trial sessions)
results/          Published machine-readable result snapshots
results/harbor/   Normalized job exports and generated reports
server/           Bun control plane and harness adapters
src/charts/       Chart recipes, palette and URL state - shared by report and studio
src/studio/       The chart studio (configurable graph editor)
src/              React replay and reporting interface
tests/            Playwright browser tests
docs/             How it works, evaluation protocol, architecture notes
```

Generated builds, local credentials, raw recordings, and Playwright artifacts are intentionally ignored by Git.

## Methodology

Heval separates two questions:

1. **Stack race:** How does each complete harness and recommended model perform?
2. **Harness isolation:** How do harnesses differ when the model, task, environment, and budget are held constant?

A result is intended to be publishable only when it includes immutable task and configuration metadata, raw trajectories, filesystem changes, grader output, process status, usage data when available, and explicit limitations.

## Status

Heval is experimental and its current results should not be treated as a general leaderboard. More tasks, repeated randomized trials, complete hidden graders, and joined provider usage records are required before drawing broad conclusions.

## Quick guide: results to social images

To open the full editor locally without configuring sign-in, run `bun run studio:local`
and open <http://localhost:5181/local-studio.html?job=terminal-bench-comparison&mode=presentation>.
This starts the editor and image-export API on loopback, with evaluation execution disabled.
The local entry is excluded from production builds; hosted `/studio` still requires sign-in.
Stop both servers with Ctrl+C. Use `HEVAL_STUDIO_PORT` and `HEVAL_STUDIO_API_PORT` to change ports.
For image exports, install Chromium once with `bunx playwright install chromium`; Node.js is also required.

For local publishing, install Chromium once and enable the export API before starting the full app. Node.js must also be installed for PNG rendering.

```powershell
bunx playwright install chromium
$env:HEVAL_ENABLE_EXPORTS = "1"
bun run start
```

On macOS/Linux, use `HEVAL_ENABLE_EXPORTS=1 bun run start`. Open [Studio](http://localhost:4173/studio). The Vite-only `bun run dev` command supports analysis; image publishing needs the Bun API. Publishing existing results does not require Docker or a model API key.

1. **Open results.** Pick a job or use **Open export** to load a normalized job JSON or saved bundle. Analysis, tables, and raw trials are available immediately; there is no setup wizard.
2. **Create an image.** Switch to **Presentation**, which opens **Social images**. Choose a question such as "Which model completes the most tasks?" or "What does a successful task cost?" The app selects the metric and layout.
3. **Choose a style.** Merge Gateway dark is the default. Merge Gateway light and Plain report apply coordinated fonts, colors, and contrast; Merge themes include the Gateway logo.
4. **Export.** Once the preview says **Layout checked. Ready to export.**, choose **Export image** or **Export thread ZIP**. Each exported page is checked for overlapping labels, clipping, and minimum text size. Long names may be shortened; adjustments are listed in the editor. Unresolved layout problems block export.

**Customize models, text and thread** holds the optional controls. All six models, including Sonnet, are included in the saved Merge comparison. Subtitle and direction labels are off by default; the source is **Merge Evaluations**. Return to **Analysis** to explore the data; the saved presentation stays intact. **Project** saves references and settings; **Bundle** includes the data for sharing. Undo/Redo applies to social controls while the tab remains open.

The default thread contains tasks completed, total task cost, median time per completed task, and paired slow-task/timeout charts. Cost per success and a paginated task-disagreement matrix are optional. Exports use the Merge Gateway logo and the official weekly chart palette. The current format is 1600 x 900, rendered at 2x. Existing completion video exports remain under Motion.

```sh
bun run thread:merge
bun run thread path/to/job.json path/to/settings.json output/directory
```

Use `harbor/report/thread-merge.json` as a reusable collection settings example. The ZIP contains PNGs, plotted values CSV, and a manifest with input data, hashes, settings, warnings and renderer version. No new evaluation is launched.

Social comparisons require one attempt per model on the same task set and compatible task versions. Unknown prices are N/A; unknown timing cannot be treated as fast. Slow counts include agent timeouts, which are also shown separately. The current comparison is 20 tasks per model; titles derive their count from the input.

Extension points: `src/charts/social-presets.ts` defines metric selection and cohort validation; `src/charts/social-themes.ts` registers complete styles; `src/charts/social-render.ts` implements four reusable SVG layouts; `server/social-posters.ts` embeds fonts and renders the same document for preview and download. Add metrics independently of the HTTP routes and Studio controls, which enumerate the registry.

## Repeat the same comparison

See [Reproducing evaluations](docs/reproducing-evaluations.md) for the saved six-model/20-task profile, baseline replay, fresh-run preparation and compatibility checks. Fresh runs may yield different scores, times and costs; archived results reproduce the same chart values.

## Saved evaluation workflow and public demo

The evaluation workbench lets signed-in users choose an approved model, harness, pinned task and time limit; launch and cancel attempts; reopen saved transcripts; and select graded attempts for Studio. Live values use the actual run rather than replay fixtures. Cost and token counts remain unavailable when the provider has not supplied measured values.

The early-access form now saves consented signups to server-side SQLite. It reports success only after storage succeeds, with deduplication and daily submission limits. It does not send email.

`bun run build:public` builds the independent project page with only the explicitly selected files in `results/public/`. The default catalog is empty. Existing company comparisons remain in the repository's internal workflow and are not copied into this public build. Hosted mode requires the public build.

- [DigitalOcean deployment and persistent storage](docs/deployment.md)
- [Fresh NVIDIA model comparison and GTC recording guide](docs/nvidia-gtc-demo.md)

For API calls during development, run `bun run serve` in one terminal and `bun run dev` in another. Vite now proxies `/api` to the Bun server on port 4173.

## DeepSeek V4.1 Flash harness study

See [the Merge Gateway setup and study protocol](harbor/deepseek-study/README.md)
for the nine-harness inventory, isolated tools, portable installation, a Harbor
pilot generator, compatibility gates, and the paired evaluation design.

For the current component map and both terminal/browser evaluation flows, see
[Current architecture and running an evaluation](docs/current-evaluation-flow.md).
