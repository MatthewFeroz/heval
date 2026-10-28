# Product architecture

For the implemented paths and exact user steps, see
[Current architecture and running an evaluation](current-evaluation-flow.md).
The hosted connected-runner path is:

```text
React/Vite workspace on Vercel + Clerk sign-in
                    ↕
Convex: machines, queue, status, private/shared reports
                    ↕ outbound HTTPS
OpenEval Node daemon → independent supervisor on Linux worker
                    ↓
Harbor → Docker task → coding harness → model provider
                    ↓
Task verifier → raw local artifacts → normalized report
```

Direct Harbor jobs can bypass the hosted workspace entirely. The Bun fixture
runner is a separate implementation, described below. Postgres metadata,
raw-artifact object storage and automatic sandbox provisioning are design
options, not the current connected-runner backend.


## Connected-runner preview

The implemented hosted path now uses Vercel + Clerk + Convex for the web
workspace, owned-machine registry, queue and sanitized reports. A Linux daemon
polls outbound, while an independent local supervisor launches pinned Harbor
in Docker. Durable claims prevent automatic duplicate runs across reconnects;
only queued work can move between compatible machines. This is separate from
the older Bun compatibility runner below. Provider provisioning and object
storage for raw traces remain future work; raw Harbor artifacts stay on the
worker. See [connected runners](connected-runners.md).

## Workspace workflow

The main navigation is Library, Explore and Settings. `/library` joins managed
jobs, experiments, standalone runs, report imports and baselines by their stored
IDs. A comparison appears once while progressing from provisioning to results;
its child reports remain accessible from its result view. Search and filters
include running work, baselines and public links. Team reports remain separate
when the current user does not own their source comparison.

`/library?new=1` is one setup flow for harness comparisons, model comparisons and
custom matrices. Guided and custom connected runs share the approved-profile
review table and existing runner validation. Managed execution is a run-location
choice for approved guided comparisons; advanced matrices use connected workers.

Saved results share one `ReportWorkspace` with Results, Analyze, Export and Share
sections. It embeds the existing chart/presentation editor and keeps it mounted
across section changes so unsaved drafts survive. Saving, publishing a revision,
creating a link, and publishing evidence remain explicit independent actions.
Owner/editor/viewer permissions still come from the report APIs. Viewers can
download normalized results but cannot edit charts or manage publication.

`/explore` serves the approved public run database without requiring a connected
workspace backend. `/settings` manages connected workers and provider setup.
Existing `/reports?id=…`, `/evaluations?experiment=…`, `/machines` and
`/studio?report=…` links remain supported. The standalone file editor remains
available from Import results for project and bundle workflows.

This consolidates product navigation and report components. Execution jobs,
immutable reports, chart drafts, baselines and public revisions keep their
existing storage and authorization boundaries; no data migration is required.

App layout uses the shared spacing tokens in `src/tokens.css`: page gutters,
card padding, section gaps and control sizes. Report form styles exclude the
embedded Studio and public run database; Studio styles stay inside `.studio`.
The editor uses its available width to collapse settings on compact layouts,
keeping the chart accessible while preserving draft state and every control.
Chart and export palettes and rendering remain independent of app spacing.

## Boundaries

The optional managed beta adds a Railway coordinator consuming a Convex queue.
It creates one Daytona Linux VM per comparison from an approved image digest,
mints a model-restricted expiring Gateway key, and activates the existing OpenEval
runner inside that VM. Harbor still executes the task containers. Durable
leases, a provider TTL, cleanup reservations and the original runner claims
control recovery. Managed execution is disabled until explicitly configured;
see [managed comparisons](managed-comparisons.md) for setup and acceptance.

Baselines store immutable execution conditions and result summaries. Repeat
comparisons preserve task pins and execution settings. Trial evidence has a
separate bounded text-artifact path, remains private on capture, and requires
explicit owner review/publication before appearing on a shared report link.

- **OpenEval owns:** normalized manifests, reproducibility, comparison logic, run pages, visualizations, reports, alerts, and historical data.
- **Harbor owns:** portable task, agent, environment, trial, and verifier execution.
- **Sandbox provider owns:** isolation, snapshots, compute, networking, and teardown.
- **Object storage owns:** PTY recordings, patches, logs, grader artifacts, and chart exports.

The sandbox provider must remain replaceable. Local Docker is the development backend; Daytona is the preferred first hosted backend because Harbor already supports it. Vercel Sandbox can be added behind the same provider interface.

The legacy interactive `concurrent-cache-v1` runner now uses the `WorkerBackend` interface in `server/docker.ts` for both agent execution and a fresh networkless grader. It no longer executes candidate code on the host. The single-process control plane enforces user ownership, capacity, timeouts and append-only recordings. This is a local compatibility path; Harbor still owns portable benchmark jobs. Do not introduce a second hosted scheduler around this compatibility adapter.

Docker policy uses a non-root user, read-only root filesystem, dropped capabilities, process/CPU/memory limits, and named workspace volumes without host bind mounts. See the [Docker run reference](https://docs.docker.com/reference/cli/docker/container/run/) for the underlying flags. Agent egress is still permitted, so this is not an internet-facing multi-tenant security boundary.

## Visualization pipeline

Normalized run metrics are stored as rows and exported as JSON/Parquet. Vega-Lite specifications define reproducible charts. The product should expose safe controls for fields, marks, colors, labels, sorting, and themes while retaining the underlying Vega-Lite JSON. SVG is the canonical export; PNG and social cards are rendered from it.

### Implemented

The first slice of this pipeline is built over Harbor job output:

- `harbor/report/trials.ts` reads a Harbor job directory and normalizes each trial to a `TrialRow`
  (harness, in-sandbox harness version, model, provider, task and its checksum, reward, agent-step
  seconds separated from total trial seconds, token counts, provider-reported cost, error).
- `src/charts/recipes.ts` maps `(rows, ChartState)` to a Vega-Lite spec plus the table of plotted
  numbers and any warnings. It is the single definition of a OpenEval chart.
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

Run inspection lives in Results: task browsing, pinned-task comparison, recorded timelines and bounded visual evidence. Evidence remains separate from chart drafts and requires owner publication for public links. See [run inspection](run-inspection.md) for capture formats, limits and worker upload behavior.
