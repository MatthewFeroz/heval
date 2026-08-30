# Product architecture

```text
React product and chart studio
          │
          ▼
Bun control plane
  manifests · queue · WebSockets · artifact API
          │
          ▼
Harbor evaluation worker
  tasks · agent adapters · verifiers · trials
          │
          ▼
Sandbox provider
  local Docker → Daytona → optional Vercel Sandbox
          │
          ▼
Postgres metadata + object storage artifacts
```

## Boundaries

- **Heval owns:** normalized manifests, reproducibility, comparison logic, run pages, visualizations, reports, alerts, and historical data.
- **Harbor owns:** portable task, agent, environment, trial, and verifier execution.
- **Sandbox provider owns:** isolation, snapshots, compute, networking, and teardown.
- **Object storage owns:** PTY recordings, patches, logs, grader artifacts, and chart exports.

The sandbox provider must remain replaceable. Local Docker is the development backend; Daytona is the preferred first hosted backend because Harbor already supports it. Vercel Sandbox can be added behind the same provider interface.

## Visualization pipeline

Normalized run metrics are stored as rows and exported as JSON/Parquet. Vega-Lite specifications define reproducible charts. The product should expose safe controls for fields, marks, colors, labels, sorting, and themes while retaining the underlying Vega-Lite JSON. SVG is the canonical export; PNG and social cards are rendered from it.

Initial chart recipes:

- Quality versus cost scatterplot with Pareto frontier
- Success rate with uncertainty intervals
- Duration and cost distribution by stack
- Tool-action timeline
- Read/edit/test action composition
- Version-over-version regression chart

## Deployment progression

1. Local Bun + Docker to prove one reproducible evaluation.
2. Hosted web/control plane with a single Daytona worker and object storage.
3. Queue, retries, concurrency limits, scheduled release sweeps, and alerts.
4. Team/private datasets only after the public index demonstrates repeated use.
