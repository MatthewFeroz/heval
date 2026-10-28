# Launch polish

The next CLI candidate is 0.3.2. Source and package metadata use Apache-2.0,
with LICENSE and NOTICE in the tarball. Already published 0.3.1 keeps its original
metadata. This change does not publish a package or alter older registry releases.
Harness artwork, DM Sans, and bundled dependencies retain their own notices.

The homepage includes Open Graph and Twitter metadata and a 1200×630
`openeval-social.png` card. Private report pages remain noindex and do not
expose report titles or evidence in social metadata.

## Monitoring

Enable Web Analytics in the existing Vercel project dashboard before deployment.
The client loads it only on the public homepage, Explore and login when the URL
and referrer contain no private query or hash. It does not track workspace pages
or comparison selections. No custom data events are sent.

For browser error monitoring, create a Sentry browser project and configure its
DSN as `VITE_SENTRY_DSN` in Vercel, then rebuild. Leave it unset to disable Sentry.
The DSN identifies the ingest project and is intended for browser use; do not
configure a Sentry organization auth token as a VITE variable. Disable IP storage
in the Sentry project and review its retention and access settings.

Error events retain exception types and code locations from built assets. They
discard exception text, breadcrumbs, request URLs, query strings, hashes, user
records and application state. Default integrations, replay and performance
tracing are not enabled. Confirm receipt of a deliberate test error in a preview
with the project DSN before treating monitoring as operational. The hosted
canonical hostname guard must also be updated for that deliberate preview check.

## Report deletion

An owner can delete a report from Share by typing its exact title. Data, projects,
revisions, evidence, memberships, invitations and export records are removed in
one transaction. Shared links stop resolving immediately. Used share tokens stay
reserved. Evaluation history and summary metrics survive without the report link.

Baseline references, active evaluations and rendering exports block deletion.
Queued exports are removed with their inputs. Finished export files are deleted
asynchronously using Vercel Blob, with up to ten delayed retries. Inspect failed
scheduled cleanup jobs in Convex if deletion continues to fail. In-flight
renderers already remove files when their completion is rejected. Downloaded
copies and recorded metrics in separate combined reports cannot be recalled.

## Rehearsal

Run `bun run cli:pack`, `bun run cli:smoke` and `bun run cli:setup:smoke` against
the candidate. The setup check provisions a dedicated disposable Docker worker,
executes the Oracle reference task without model calls, exercises the private
setup UI and restart recovery, and removes its resources. It does not prove
Windows/WSL or every physical machine configuration.

A model-backed video comparison still requires a chosen task set, models,
harnesses, serving routes and approval to spend provider credits. Keep that run
separate from no-model acceptance. Review its evidence before publishing it.
