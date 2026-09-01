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

### Implemented

The first slice of this pipeline is built over Harbor job output:

- `harbor/report/trials.ts` reads a Harbor job directory and normalizes each trial to a `TrialRow`
  (harness, in-sandbox harness version, model, provider, task and its checksum, reward, agent-step
  seconds separated from total trial seconds, token counts, provider-reported cost, error).
- `src/charts/recipes.ts` maps `(rows, ChartState)` to a Vega-Lite spec plus the table of plotted
  numbers and any warnings. It is the single definition of a Heval chart.
- `harbor/report/build-report.ts` compiles those specs to SVG headlessly and emits a self-contained
  HTML report; `src/studio/` renders the same specs in the browser as a configurable editor.
- `src/charts/url.ts` serializes `ChartState` into the query string, so report and studio link both
  ways and a chart is reproducible from its URL.

Two constraints are enforced in the recipe layer rather than left to the person making the chart:
the categorical palette is capped at four validated series (color is dropped, with an explanation,
rather than a fifth hue being generated), and each theme's steps are validated against that theme's
own surface instead of being flipped from the other.

Chart recipes:

- Quality versus cost scatterplot with Pareto frontier *(implemented)*
- Success rate with uncertainty intervals *(implemented - Wilson 95%)*
- Duration and cost distribution by stack *(implemented - strip plot)*
- Per-task pass matrix on a single-hue ramp *(implemented)*
- Tool-action timeline
- Read/edit/test action composition
- Version-over-version regression chart

## Deployment progression

1. Local Bun + Docker to prove one reproducible evaluation.
2. Hosted web/control plane with a single Daytona worker and object storage.
3. Queue, retries, concurrency limits, scheduled release sweeps, and alerts.
4. Team/private datasets only after the public index demonstrates repeated use.
