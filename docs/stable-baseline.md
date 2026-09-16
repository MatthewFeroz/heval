# Consolidated Heval baseline

This integration preserves the histories of all three branches from their
shared `7c9f10f` base:

- `t3code/host-heval-on-vercel` at `cd1527f`: Vercel routing, redesigned
  showcase, and the Terminal Bench Comparison dataset rename.
- `t3code/improve-eval-user-flow` at `bce1d4d`: published CLI, installation
  tests, workflow design, and preparatory Convex dependencies.
- `t3code/assess-mvp-status` at `56e7e50`: authenticated workbench, persistent
  run history, provider connections, signup storage, and Linux deployment.

Merge commits retain each branch's ancestry. New work should branch from the
consolidated `origin/main`, rather than continuing from the old branch tips.
Existing worktrees and unpublished local files must be preserved when updating
an older checkout; do not reset them to synchronize branches.

## Resolved overlaps

The redesigned homepage retains its replay and measured comparison. The Bun
build adds the evaluation workbench and server-backed signup. Shared WorkOS
authentication also protects saved attempts opened in Studio. CLI mode keeps
its account-free, read-only local viewer and browser exports.

The Vercel build explicitly sets `VITE_HEVAL_STATIC_SITE=1`: its static pages
do not offer controls that require the Bun runner, signup, or media-rendering
APIs. Presentation opens the browser-rendered poster with SVG/PNG export.
The existing Vercel project can use the committed `vercel.json` directly.

The renamed example is `results/harbor/terminal-bench-comparison.json`. CLI
builds and tests use that name. Previously published npm packages remain
unchanged until a separate versioned release.

The public Bun build remains distinct: it publishes only `results/public`,
excludes the showcase's embedded comparison and browser test fixtures, and
requires explicit hosted configuration. The Docker context includes the two
JSON files needed to type-check the unused showcase module; the deployment
smoke test checks that those comparison fixtures do not appear in public web
assets.

## Verification

Run the normal build, lint, project/chart and server tests, desktop/mobile
browser suite, CLI pack/install smoke test, and Docker isolation test.
`bun run test:deployments` additionally checks the real production outputs for
Vercel routing, charts/downloads without an API, mobile layout, public catalog
isolation, Bun startup, and authentication on saved run endpoints. CI runs the
deployment checks as well.

## What remains future work

Convex is not configured. Hosted import, durable reports, and revocable sharing
are the next feature, followed by Harbor cloud execution. The existing hosted
worker operates the legacy fixture; it is not a general Harbor scheduler.
Integration testing makes no paid model calls and does not provision a cloud
worker, database, or new production deployment.
