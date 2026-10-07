# Hosted import → saved report → share → revoke

Open `/reports` on your Heval deployment. The frontend runs on Vercel; reports persist in Convex, independently of frontend deployments or the uploader’s computer.

## User walkthrough

1. **Open Report library and sign in.** Use this import path for results created
   outside Heval's connected evaluation flow. Sign-in returns to the workspace.
2. **Choose Harbor JSON.** Import a normalized `schemaVersion: 1` export containing `rows`. An invalid file produces an explanation before anything is saved.
3. **Review and name it.** Check trial, model, and task counts. Expand **Review exact saved data** to inspect the complete sanitized payload. Edit the title.
4. **Save private report.** Heval saves the snapshot online and opens its report page. The badge says **Public link off**. Reloading preserves the report; **Your saved reports** lets you find it later.
5. **Read the result.** Inspect completion rates, filter by model, and expand the trial table. These controls explore the snapshot without changing the saved data. Small setup runs are explicitly not full benchmark scores.
6. **Create share link → Copy link.** Sharing is an explicit action after saving. Anyone holding the link can read the complete report without signing in. The shared page has no owner controls.
7. **Revoke link → Yes, revoke link.** Existing connected viewers switch to **This link is unavailable**. Fresh visits also fail. Your private report stays saved.
8. **Share again when needed.** A new link gets a new token. The old link stays revoked.

Revocation stops future access through Heval. It cannot erase screenshots or copies a recipient already saved. Links are unlisted capabilities, not invitations restricted to particular recipients. A disconnected shared page hides the report while it checks access again.

## Team editing

The current checkout implements this flow. Local checks below verify its access
rules; they do not establish the state of a hosted deployment:

1. Open a saved report and choose **Edit chart in Studio**. Change the chart recipe, measures, labels, filters, or presentation settings, then **Save draft**.
2. Return through **View report** to review the saved draft. The hosted viewer renders the same chart recipe and filters as Studio. Reloading restores saved settings.
3. On the first **Create share link**, the saved draft becomes the published version. Later edits remain private to the report team until the owner clicks **Publish saved draft**. Revoking and recreating a link preserves the last published version.
4. Under **Edit with your team**, create an editor or viewer invitation. Send the link directly to a teammate; they sign in and accept. Each invitation admits one account and expires in seven days. A report supports up to 20 teammates.
5. Editors can save drafts and queue private exports. Viewers can inspect drafts
   and download completed exports while they remain members. Only the owner can
   publish, manage public links, inspect the team, create/revoke invitations, or
   remove teammates. Removing a teammate denies future private reads, writes,
   export submissions and downloads, including exports that teammate submitted.
   Revoking a public link does not remove team access. Neither action can recall
   copies already downloaded.
6. If someone else saves first, Studio blocks overwriting that version. Download **Bundle** to keep your local edits, then **Reload latest**. This is versioned collaboration, not simultaneous cursor editing or automatic merging.

Hosted saving supports the built-in chart controls and up to 20 views and 20 presentations per report (150 KB of settings). Custom Vega specs remain a local-bundle feature. Public viewers receive the imported data as well as the published chart settings; chart filters are presentation controls, not data access restrictions.

Backend tests cover publication boundaries, stale writes, roles, invitation
expiry/revocation, removal, legacy reports, immutable evidence, and custom-spec
rejection. A full
Clerk browser check of invitation → editor save → owner publish remains a
hosted acceptance check; it was not performed for the local validation below.

## Private report access validation

The report and export authorization suites use
[`tests/fixtures/report-sharing.json`](../tests/fixtures/report-sharing.json), a
four-trial **synthetic** report with invented harness, model and task labels.
These values are demonstration fixtures, not measured benchmark results. Tests
run through `convex-test` with owner, editor, viewer and anonymous identities;
no hosted Convex deployment or real user report is used.

| Boundary | Verified behavior |
| --- | --- |
| Private draft | Anonymous reads require sign-in; signed-in nonmembers get no report. Knowing a report/export ID does not grant access. |
| Studio save | Changes to titles, recipes, filters and presentation settings change the project draft/version. The stored trial data and source pins stay unchanged after saving, exporting, publishing, revoking and sharing again. |
| Owner controls | Viewers, editors and anonymous callers cannot publish, create/revoke public links, read/manage memberships, or create/revoke invitations. Editors can save drafts; viewers cannot. |
| Published revision | Public reads return the published project/version and the complete sanitized trial data. Later draft edits and private export submissions do not publish changes. The public response has no worker credential or control capability; report membership does not grant worker reads or controls either. |
| Revoked link | Fresh reads fail immediately after revocation. Sharing again requires a different token, leaves the old token dead and retains the last published revision until the owner explicitly publishes another draft. |
| Removed member | Both roles lose private listing/reads, draft writes, export history/submission and completed-export downloads. Used invitations cannot restore removed access. The download proxy rechecks membership even after an earlier successful download. |

Reproduce with `bun run test:backend` and `bun run test:exports`. Existing
publication and invitation tests were extended where coverage was missing;
authorization is checked at the backend and download proxy rather than inferred
from hidden buttons. See [hosted export validation](hosted-presentation-exports.md#validation)
for the storage boundary.

Removal denies **private** access. A removed member who holds an active public
link can still read its published revision just like any other public reader;
revoke that link separately when needed. Public links expose the full sanitized
dataset, regardless of chart filters. Data already received, downloaded files,
screenshots, and a download authorized before removal cannot be recalled.
These tests do not verify real Clerk sign-in, live browser subscriptions,
Sandbox rendering or deployed Blob configuration. Those remain environment
acceptance checks using synthetic data in an explicitly authorized isolated
environment.

The connected evaluation flow now runs Harbor on a paired machine and creates
its reports automatically. Manual import remains useful for direct Harbor jobs
and historical exports.

## First-release boundaries

- Normalized Harbor JSON only: 1–500 trials, at most 750,000 bytes, up to 100 reports per account. Raw job folders, raw Harbor `result.json`, and Studio project/bundle files are not accepted.
- Generate an export from a Heval checkout with `bun run report path/to/harbor-job`. Upload the resulting `results/harbor/<job>.json`. The published CLI can inspect results locally; this release does not add CLI upload or a CLI JSON-export command.
- The server independently validates every import. It stores an allowlist of trial labels, outcomes, timings, usage, cost, and selected provenance fields. Configuration, local source paths, error text, logs, and unknown fields are discarded. Labels can still contain sensitive text, so review them before sharing.
- Imported evaluation data remains immutable. Chart drafts, saved views,
  presentation settings, and report titles can be edited in hosted Studio.
  Deleting reports and uploading existing Studio bundles remain future work. No
  model calls or Docker compute are required to import, edit, or view results;
  connected evaluations execute on the paired machine.
- Sharing tokens live in the URL fragment, so they are not sent to Vercel as request paths or referrers. Every data read checks the active token in Convex; there is no public storage-file URL that can outlive revocation.

## Deployment

Use separate Convex projects or deployments for production, development, and smoke tests.
For current Clerk configuration and ownership migration, follow
[Clerk sign-in setup](clerk-auth.md). Set the matching publishable key,
canonical workspace origin and Convex URL in the frontend, and configure the
Clerk `convex` JWT template and issuer in the selected backend deployment.
`scripts/vercel-build.ts` coordinates production frontend/backend builds using
`CONVEX_DEPLOY_KEY`; keep that key out of browser variables.

Keep Vercel Standard Protection: production aliases must be public for
anonymous report links, while preview/generated deployment URLs remain
protected. The previous WorkOS production deployment is not automatically
migrated by a source change or a successful development deployment.

Without a Convex URL, `/reports` shows a storage-not-connected message instead
of pretending data was saved. Local CLI viewing remains account-free.

## Reproduce the smoke test

```sh
bun run test:backend
bunx convex deployment create smoke-reports --type preview --expiration 'in 1 day'
bunx convex deployment token create heval-report-smoke \
  --deployment preview/smoke-reports --save-env /tmp/heval-smoke.env
HEVAL_SMOKE_ENV=/tmp/heval-smoke.env \
HEVAL_SMOKE_URL=https://YOUR-PREVIEW.convex.cloud \
  bun run test:reports:smoke
```

Use a disposable deployment: the script installs a test JWT issuer there. It refuses production deploy keys and requires the URL to match the key’s deployment. It does not modify production auth or inject an administrator key into the browser. Videos, screenshots, and a JSON check report go to `recordings/hosted-report-flow/`. Keep deploy-key files private and delete the temporary key when finished.

The production integration follows [Convex’s Vercel deployment guide](https://docs.convex.dev/production/hosting/vercel) and [Clerk integration](https://docs.convex.dev/auth/clerk). The isolated smoke identity uses Convex’s documented [custom JWT verification](https://docs.convex.dev/auth/advanced/custom-jwt).

## Studio sign-in gate

Every hosted Studio entry (`/studio` and `/studio.html`, including job, run, and
saved-report links) requires a resolved Clerk session. Loading, signed-out, and
unconfigured-auth states never mount the editor. The login route preserves the
requested path, query and fragment while moving sign-in to the configured
canonical workspace origin. Clerk restores the session across reloads and
separate app pages. Signing out or losing the session unmounts Studio.

`bun run test:auth` checks the redirect and API-token boundary. A live Clerk
credential-entry/session test is separate from these contract checks and from
earlier WorkOS-era smoke checks.

This page gate complements the existing Convex membership checks and Bun bearer
token checks; it does not make intentionally published report files private.
Shared report links remain available through `/share`. The separately packaged
local CLI viewer does not use the hosted route and still works without login.
Browser tests inject sessions through files under `tests/fixtures/`, which are
excluded from production builds; there is no query parameter or storage flag
that bypasses authentication in the shipped app.

## First evaluation setup

Runner Setup owns one progressive flow: **Set up your machine → Connect your
computer → Connect your model provider → Run your first evaluation**. Only the
current action is shown. Evaluations owns configuration, live progress, and all
run history, including older individual runs. The account menu's **Set up a
computer** entry opens `/machines?setup=1`.

The local setup page opens Heval with its loopback capability in a URL fragment.
Heval removes it before sign-in and asks the user to confirm the connection.
A short-lived account pairing is returned to that local page, which connects the
worker and guides provider configuration. Provider keys remain on the worker.
`HEVAL_APP_URL` selects the hosted origin for a custom deployment or local test;
it must use HTTPS, except for localhost development.

The final action atomically queues a free Oracle worker check and the model
experiment. The server permits model work only after a completed check with
passing results. Closing the browser does not interrupt this sequence. A failed
check starts no model task; cancellation includes the check. Setup-check trials
are excluded from the combined model report.

Connection, profile, and result state determine progress. The browser remembers
only the install acknowledgment and a temporary local handoff. Existing account
completion preferences remain compatible. `heval setup` is still a preview and
requires a setup-enabled CLI build until the next npm release.

`bun run test:onboarding:ui` uses the real local setup server and product screens
with simulated auth, cloud state, and worker/provider adapters. Backend tests
exercise atomic dispatch, prerequisite failures, cancellation, and ownership.

## Presentation editing on static hosting

Studio's Presentation → Social images tab includes the Question, Style and model
controls on Vercel and for saved reports. Preview/layout checks and SVG download
run in the browser without the Bun poster API. Browser previews use available
fonts. Original-font PNG and thread ZIP rendering can run in Vercel Sandbox,
with a Convex queue and private Blob storage. See [hosted presentation exports](hosted-presentation-exports.md)
for configuration and deployment. The Poster tab exposes the graph recipe controls.

Hosted draft saves retain social question/style/model settings across reloads
and publication. Deploy the frontend and Convex changes together to enable this
behavior. The packaged local results viewer retains its simpler chart interface.

## Clerk migration

The browser now uses Clerk; earlier WorkOS-era smoke checks documented
the previous configuration. For current setup, coordinated
cutover, account ownership preservation and session acceptance, follow
[Clerk sign-in](clerk-auth.md). Previous WorkOS smoke recordings do not validate
the Clerk credential-entry flow.
