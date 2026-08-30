# Heval

A local-first harness-evals MVP for replaying and publishing side-by-side coding-agent stack benchmarks.

## What is included

- Four synchronized agent lanes with pinned harness and model versions
- Replay controls, live cost/time/token counters, pass/fail states, and a final verdict
- Task ranking, metric cards, reports, methodology, and responsive navigation
- A locally persisted early-access form
- Desktop and mobile browser tests for the primary interactions

The benchmark shown in the interface is intentionally seeded demo data. It is labeled as a verified replay in the product UI, but it should be replaced with a real captured run before a public launch.

## Local development

```bash
npm install
npm run dev
```

Then open `http://localhost:5173`.

## Verification

```bash
npm run build
npm run lint
npm run test:e2e
```

## Storage

No S3-compatible service is required for this MVP. User preferences are stored in browser local storage and the seeded experiment data ships with the application. When real trajectories are connected, start with a local `data/` directory through a storage adapter; an S3 or Cloudflare R2 implementation can be added behind the same interface later.

## Connecting real evaluations

The intended next integration is Harbor:

1. Run a pinned dataset, harness, and model with Harbor in local Docker.
2. Capture each trial's manifest, trajectory, artifacts, timing, usage, and grader result.
3. Convert those records into the `Experiment`, `Runner`, and `RunEvent` shapes in `src/data.ts`.
4. Store raw artifacts outside the web bundle and expose them through a small local API.

Real runs require model-provider credentials and Docker. Cloud execution and object storage can wait until local runs demonstrate audience demand.
