# Heval

A local-first harness-evals MVP for replaying and publishing side-by-side coding-agent stack benchmarks.

## What is included

- Four synchronized agent lanes with pinned harness and model versions
- Replay controls, live cost/time/token counters, pass/fail states, and a final verdict
- Task ranking, metric cards, reports, methodology, and responsive navigation
- A protected Bun PTY runner for opt-in real harness execution
- Raw ANSI streaming over WebSockets and persisted timestamped recordings
- A locally persisted early-access form
- Desktop and mobile browser tests for the primary interactions

The benchmark initially shown in the interface is intentionally seeded demo data and is labeled `SEEDED UI REPLAY`. A run becomes publishable only after it has an immutable manifest, raw trajectory, grader output, and final artifact.

## Local development

```bash
bun install
bun run dev
```

Then open `http://localhost:5173`.

## Verification

```bash
bun run build
bun run lint
bun run test:e2e
```

## Storage

No S3-compatible service is required for this MVP. User preferences are stored in browser local storage and the seeded experiment data ships with the application. When real trajectories are connected, start with a local `data/` directory through a storage adapter; an S3 or Cloudflare R2 implementation can be added behind the same interface later.

## Real evaluations

The Bun runner in `server/` is the capture path for the first local evaluation. The intended scalable execution layer is Harbor:

1. Run a pinned dataset, harness, and model with Harbor in local Docker.
2. Capture each trial's manifest, trajectory, artifacts, timing, usage, and grader result.
3. Normalize those records into immutable run manifests rather than hand-authored UI events.
4. Store raw artifacts outside the web bundle and expose them through a small local API.

Real runs require model-provider credentials and Docker. Cloud execution and object storage can wait until local runs demonstrate audience demand.

See [the first evaluation plan](docs/first-eval.md) and [the product architecture](docs/architecture.md).
