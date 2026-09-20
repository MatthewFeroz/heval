# Hosted presentation exports

Studio can save a catalog presentation online, reopen its questions and graph settings, queue PNG/thread ZIP exports, and download completed exports after closing the browser. This implementation uses the existing Vercel website and Convex backend, Vercel Sandbox for Chromium, and **private** Vercel Blob storage. No user machine runs the renderer.

The implementation must be deployed and configured before hosted export buttons become available. This does not enable hosted Harbor evaluations or video export.

## Runtime

1. For catalog data, **Save presentation online** atomically imports the normalized data and the current project into the workspace. The initial implementation supports one evaluation source, up to the existing 500-trial/750 KB report limits. Hosted custom Vega specs remain unsupported.
2. In saved Studio, **Export PNG online** or **Export thread ZIP online** validates the draft/version, saves the exact project, and creates a queued export in one Convex transaction. It does not publish the draft.
3. A scheduled internal mutation claims one job. A scheduled Node action starts a nonpersistent Sandbox from the pinned renderer snapshot, with outbound networking denied and no credentials inside the VM.
4. The shared `server/social-posters.ts` renderer produces the artifact. The action reads it over the Sandbox API and uploads it to private Blob storage. The VM stops in `finally`, with a four-minute hard VM lifetime as a fallback.
5. Export history subscribes to Convex. Its Download button calls the Vercel `/api/presentation-export` function with the current WorkOS access token. Convex checks current report membership before the function streams the private blob; responses are not cached publicly.

Each job retains the submitted project, resolved input, settings hash, saved draft version and renderer snapshot ID. Changing the draft does not alter past exports. ZIPs include the existing renderer manifest and values CSV. Multi-page image questions return a ZIP.

## Configure and deploy

Create a Vercel access token scoped to the team owning the existing Heval project. Copy the Project ID and Team ID from Vercel settings. Create a **private Blob store**, attach it to that project, and obtain its read/write token. Obtain a deployment-scoped Convex deploy key for the intended backend.

Keep credentials in the ignored `deploy/hosted-exports.env`, mode `0600`:

```dotenv
VERCEL_TOKEN=
VERCEL_PROJECT_ID=
VERCEL_TEAM_ID=
BLOB_READ_WRITE_TOKEN=
CONVEX_DEPLOY_KEY=
```

Do not prefix secrets with `VITE_`. Never place this file in the renderer snapshot, commit it, or paste its contents into logs.

Build the renderer snapshot **once per renderer or asset change**:

```sh
bun --env-file=deploy/hosted-exports.env run exports:snapshot
```

This command consumes cloud Sandbox resources. It starts the managed Node 24 Ubuntu image, installs the exact locally resolved Playwright version and Chromium dependencies, uploads only the bundled renderer and required assets, and runs a PNG smoke test. It removes smoke artifacts before snapshotting. It prints `HEVAL_EXPORT_SNAPSHOT_ID=...`; add that non-secret ID to the env file. The snapshot has no automatic expiration. Remove superseded snapshots after queued jobs using them finish; existing downloads do not need snapshots.

Set these **Convex deployment environment variables**:

- `VERCEL_TOKEN`, `VERCEL_PROJECT_ID`, `VERCEL_TEAM_ID`
- `BLOB_READ_WRITE_TOKEN`
- `HEVAL_EXPORT_SNAPSHOT_ID`

Use Convex dashboard environment settings, or pipe values to `convex env set NAME` so secrets do not appear in command arguments/history. `CONVEX_DEPLOY_KEY` authenticates deployment commands; it is not a runtime variable.

Set these **Vercel production environment variables**:

- `BLOB_READ_WRITE_TOKEN` for the attached private store
- `CONVEX_URL` for the same backend the frontend uses (or runtime `VITE_CONVEX_URL`)
- `CONVEX_DEPLOY_KEY` for the existing `scripts/vercel-build.ts` integration
- Retain the existing WorkOS and frontend configuration.

Deploy the backend and frontend together using the existing Vercel build. The build deploys Convex and supplies `VITE_CONVEX_URL` to Vite. The download function must point to that same deployment. Preview deployments should use a separate backend and storage credentials, or leave rendering unconfigured.

A production check: log in, open the comparison in Studio, choose a question/theme/models, save online, export PNG, close the tab, return through Reports → Studio, download the artifact, then export a ZIP. Verify an unauthenticated download fails and a removed member cannot download. Check Sandbox shutdown and Blob privacy in the dashboards.

## Limits and recovery

- One rendering job per Convex deployment; at most 20 waiting jobs.
- At most 20 submissions per user per rolling 24 hours (failed jobs count).
- At most 12 images, 750 KB resolved input and 20 MB output per export.
- Sandbox timeout: four minutes. An eight-minute watchdog marks an interrupted action failed and releases the queue.
- No automatic render retries or model API calls. A user can submit another job after failure.
- The UI shows the most recent 50 exports for a report; stored older artifacts are retained. Retention/deletion policies are not automated in this initial implementation.
- Downloads are private and require current report access, including for completed jobs. Public report sharing does not grant export download access.

## Validation

```sh
bun run test:reports
bun run test:exports
bun run test:exports:renderer
bun run test:exports:ui
bun run test:auth
bunx tsc -b
bunx tsc -p convex/tsconfig.json --noEmit
bun run lint
```

Backend tests exercise atomic save/enqueue, immutable inputs, access revocation, idempotency, version conflicts and crash recovery. Worker/proxy tests mock cloud SDKs and verify private storage, credential boundaries, failure cleanup and access checks. The UI smoke exercises real Studio components with simulated cloud adapters: queue, reload, settings, history and authorized download. The renderer smoke runs the **actual Node bundle and Chromium** locally to generate PNG and ZIP artifacts; the snapshot setup repeats a PNG check on Vercel. These local checks do not establish that a production deployment is configured.

## Verified deployment — September 17, 2026

The feature is deployed to the existing Vercel `heval` project at
https://temporary-rushing-violet-xu17m97.vercel.app, using the existing Convex
`industrious-newt-432` production deployment. The private Blob store is
`heval-presentation-exports`. Snapshot: `snap_DdjQf4zNX3Xs99Hb6ugW52zS9Lnt`.

Live checks passed for both PNG and ZIP: authenticated submission to Convex,
queue claim, scheduled Node action, Sandbox rendering, private Blob upload,
persistent history and authorized storage read. The deployed website download
endpoint returns 401 when signed out. The full browser interaction was tested
with simulated cloud adapters; a real WorkOS browser-session download still
needs a signed-in user check.

The opt-in `scripts/hosted-export-cloud-smoke.ts` repeats the live queue checks.
It retains a private smoke report and its exports under the synthetic
`heval-deployment-smoke` identity, separate from real user workspaces.
The CLI deployment used the current working tree; GitHub main has not yet been
updated with these changes.

## Presentation style and persistence

New presentations start with **White** (`plain-light`). **Black** (`plain-dark`)
is also unbranded; Merge themes are explicit choices. Product defaults live in
`src/charts/presentation-defaults.ts` and apply regardless of whether data came
from the catalog, a local import, a runner, or a saved report. New projects save
the choice explicitly rather than relying on a changing runtime fallback.

A saved report stores its project document in `reportProjects.draft`:

```json
{
  "project": {
    "presentations": [{
      "theme": "plain-dark",
      "social": { "version": 1, "theme": "plain-dark" },
      "graphOverrides": { "theme": "dark" }
    }]
  }
}
```

This is an abbreviated example; the real document includes data pins, questions,
models, source labels and other settings. Save draft persists the current choice;
Export saves and queues atomically. Public shares use the published revision,
so publishing is a separate explicit action. No new preference table is needed.
If per-user defaults are added later, they should seed a *new* project, never
replace the theme of a saved project.

Explicit existing themes are preserved, including Merge. Missing legacy social
settings use White and are materialized on the next save. No production documents
are bulk-recolored. To change an older Merge presentation, select White or Black
and save it once. Historical export files remain unchanged.

The shared SVG renderer (`social-presets/4`) now uses the designer layout for
browser previews and hosted exports. Merge opt-in adds top-right branding,
per-metric hues and model logo tiles with an above-bar fallback for short bars.
Neutral themes use the same geometry without Merge marks, palette or licensed
fonts. Tests cover creation defaults, all themes/presets, reload persistence,
export snapshots and switching styles across the social and poster controls.
