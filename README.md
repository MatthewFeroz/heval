# Heval

Heval is a local-first evaluation workbench for comparing coding-agent stacks on the same task, environment, model, and budget.

It captures terminal trajectories, grades the resulting workspace with executable tests, and presents synchronized side-by-side replays for Claude Code, Codex, OpenCode, and Pi.

> [!NOTE]
> Heval is an early prototype. The landing-page replay and JSON files in [`results/`](results/) are development fixtures. **No real benchmark runs have been published yet.**

## Features

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

### Requirements

- [Bun](https://bun.sh/) 1.4 or newer
- A Chromium-compatible browser
- [Harbor](https://pypi.org/project/harbor/) 0.22.0 and Docker, for Harbor-based evaluations (`uv tool install harbor==0.22.0`)

```bash
git clone https://github.com/MatthewFeroz/heval.git
cd heval
bun install
bun run dev
```

Open `http://localhost:5173`.

## Authentication

The public showcase works without configuration. WorkOS AuthKit sign-in gates real evaluation controls and the Bun server verifies every runner access token against WorkOS's JWKS.

1. In the WorkOS Dashboard, copy your environment's client ID into both `VITE_WORKOS_CLIENT_ID` and `WORKOS_CLIENT_ID` in `.env.local` (start from `.env.example`). The client ID is public; no WorkOS API key is used by this integration.
2. Add `http://localhost:5173` as an allowed web origin and sign-in callback redirect URI.
3. Add `http://localhost:5173/login` as the Sign-in URL.
4. For the hosted app, add its exact HTTPS origin and root callback in the same places, plus `<origin>/login` as its Sign-in URL.
5. If using a custom Authentication API domain, set `VITE_WORKOS_API_HOSTNAME` and `WORKOS_API_HOSTNAME` to the hostname only (for example, `auth.example.com`). Otherwise leave the browser value empty and keep the server value at `api.workos.com`.

Set `HEVAL_ENABLE_RUNNER=1` only where real harness execution should be allowed. `HEVAL_GATEWAY_API_KEY` remains server-side and must never use a `VITE_` prefix.

## Commands

| Command | Purpose |
| --- | --- |
| `bun run dev` | Start the Vite development server |
| `bun run build` | Type-check and create a production build |
| `bun run serve` | Serve the built app and local runner API |
| `bun run start` | Build, then start the Bun server |
| `bun run lint` | Run ESLint |
| `bun run test:e2e` | Run desktop and mobile Playwright tests |
| `bun run report <job-dir>` | Normalize a Harbor job into `results/harbor/` and build its static report |
| `bun run poster <job.json>` | Export one Merge-branded social PNG per headline graph |

Install Playwright's browser once before running end-to-end tests locally:

```bash
bunx playwright install chromium
```

## Running Real Evaluations

Real harness execution is disabled by default because agents run with broad permissions inside disposable fixture workspaces. Copy the example configuration and provide the WorkOS client ID plus a Merge Gateway API key:

```bash
cp .env.example .env.local
```

```dotenv
VITE_WORKOS_CLIENT_ID=client_replace_me
WORKOS_CLIENT_ID=client_replace_me
HEVAL_ENABLE_RUNNER=1
HEVAL_GATEWAY_API_KEY=your-key
HEVAL_GATEWAY_MODEL=anthropic/claude-sonnet-4-5-20250929
PORT=4173
```

Load the variables and start the full application:

```bash
set -a
source .env.local
set +a
bun run start
```

The runner creates a fresh temporary workspace for every attempt, writes isolated harness configuration, records PTY output under `recordings/`, and grades the modified fixture with `bun test`. Credentials are passed through the process environment and are not written to recordings.

Do not expose the runner API directly to the public internet. It is designed for trusted local use while the sandboxed worker architecture is developed.

## Architecture

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
bun run poster results/harbor/terminal-bench-composio-mirror.json --open-weight
```

The command writes 2400x2400 PNGs and editable HTML files under
`results/harbor/posters/<job>/`. Use `--panels completion,cost-per-success` to choose graphs,
`--models <model-a>,<model-b>` to set the field and color order, or `--combined` to also export a
three-panel 3200x1800 image. Run `bun run poster --help` for the full option list.

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
docs/             Evaluation protocol and architecture notes
```

Generated builds, local credentials, raw recordings, and Playwright artifacts are intentionally ignored by Git.

## Methodology

Heval separates two questions:

1. **Stack race:** How does each complete harness and recommended model perform?
2. **Harness isolation:** How do harnesses differ when the model, task, environment, and budget are held constant?

A result is intended to be publishable only when it includes immutable task and configuration metadata, raw trajectories, filesystem changes, grader output, process status, usage data when available, and explicit limitations.

## Status

Heval is experimental and its current results should not be treated as a general leaderboard. More tasks, repeated randomized trials, complete hidden graders, and joined provider usage records are required before drawing broad conclusions.
