# Heval

Heval is a local-first evaluation workbench for comparing coding-agent stacks on the same task, environment, model, and budget.

It captures terminal trajectories, grades the resulting workspace with executable tests, and presents synchronized side-by-side replays for Claude Code, Codex, OpenCode, and Pi.

> [!NOTE]
> Heval is an early prototype. The landing-page replay is seeded demonstration data. The JSON files in [`results/`](results/) are real smoke-evaluation snapshots, but they are pipeline validation rather than a statistically meaningful ranking.

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

```bash
git clone https://github.com/MatthewFeroz/heval.git
cd heval
bun install
bun run dev
```

Open `http://localhost:5173`.

## Commands

| Command | Purpose |
| --- | --- |
| `bun run dev` | Start the Vite development server |
| `bun run build` | Type-check and create a production build |
| `bun run serve` | Serve the built app and local runner API |
| `bun run start` | Build, then start the Bun server |
| `bun run lint` | Run ESLint |
| `bun run test:e2e` | Run desktop and mobile Playwright tests |

Install Playwright's browser once before running end-to-end tests locally:

```bash
bunx playwright install chromium
```

## Running Real Evaluations

Real harness execution is disabled by default because agents run with broad permissions inside disposable fixture workspaces. Copy the example configuration and provide a long random runner token plus a Merge Gateway API key:

```bash
cp .env.example .env.local
```

```dotenv
HEVAL_ENABLE_RUNNER=1
HEVAL_RUNNER_TOKEN=replace-with-a-long-random-token
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

## Repository Layout

```text
fixtures/   Pinned benchmark tasks and graders
results/    Published machine-readable result snapshots
server/     Bun control plane and harness adapters
src/        React replay and reporting interface
tests/      Playwright browser tests
docs/       Evaluation protocol and architecture notes
```

Generated builds, local credentials, raw recordings, and Playwright artifacts are intentionally ignored by Git.

## Methodology

Heval separates two questions:

1. **Stack race:** How does each complete harness and recommended model perform?
2. **Harness isolation:** How do harnesses differ when the model, task, environment, and budget are held constant?

A result is intended to be publishable only when it includes immutable task and configuration metadata, raw trajectories, filesystem changes, grader output, process status, usage data when available, and explicit limitations.

## Status

Heval is experimental and its current results should not be treated as a general leaderboard. More tasks, repeated randomized trials, complete hidden graders, and joined provider usage records are required before drawing broad conclusions.
