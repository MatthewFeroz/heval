# Hosted import → saved report → share → revoke

Open [Heval reports](https://temporary-rushing-violet-xu17m97.vercel.app/reports). The frontend runs on Vercel; reports persist in Convex, independently of frontend deployments or the uploader’s computer.

## User walkthrough

1. **Open Your reports and sign in.** The homepage’s **Import your results** button leads here. Sign-in returns to the workspace.
2. **Choose Harbor JSON.** Import a normalized `schemaVersion: 1` export containing `rows`. An invalid file produces an explanation before anything is saved.
3. **Review and name it.** Check trial, model, and task counts. Expand **Review exact saved data** to inspect the complete sanitized payload. Edit the title.
4. **Save private report.** Heval saves the snapshot online and opens its report page. The badge says **Public link off**. Reloading preserves the report; **Your saved reports** lets you find it later.
5. **Read the result.** Inspect completion rates, filter by model, and expand the trial table. These controls explore the snapshot without changing the saved data. Small setup runs are explicitly not full benchmark scores.
6. **Create share link → Copy link.** Sharing is an explicit action after saving. Anyone holding the link can read the complete report without signing in. The shared page has no owner controls.
7. **Revoke link → Yes, revoke link.** Existing connected viewers switch to **This link is unavailable**. Fresh visits also fail. Your private report stays saved.
8. **Share again when needed.** A new link gets a new token. The old link stays revoked.

Revocation stops future access through Heval. It cannot erase screenshots or copies a recipient already saved. Links are unlisted capabilities, not invitations restricted to particular recipients. A disconnected shared page hides the report while it checks access again.

## Team editing (feature branch)

The `feat/team-report-editor` branch adds this flow. These changes are not yet merged into the production site:

1. Open a saved report and choose **Edit chart in Studio**. Change the chart recipe, measures, labels, filters, or presentation settings, then **Save draft**.
2. Return through **View report** to review the saved draft. The hosted viewer renders the same chart recipe and filters as Studio. Reloading restores saved settings.
3. On the first **Create share link**, the saved draft becomes the published version. Later edits remain private to the report team until the owner clicks **Publish saved draft**. Revoking and recreating a link preserves the last published version.
4. Under **Edit with your team**, create an editor or viewer invitation. Send the link directly to a teammate; they sign in and accept. Each invitation admits one account and expires in seven days. A report supports up to 20 teammates.
5. Editors can save drafts. Viewers can inspect drafts. Only the owner can publish, manage public links, create invitations, or remove teammates. Removing a teammate denies future reads and writes; revoking a public link does not remove team access.
6. If someone else saves first, Studio blocks overwriting that version. Download **Bundle** to keep your local edits, then **Reload latest**. This is versioned collaboration, not simultaneous cursor editing or automatic merging.

Hosted saving supports the built-in chart controls and up to 20 views and 20 presentations per report (150 KB of settings). Custom Vega specs remain a local-bundle feature. Public viewers receive the imported data as well as the published chart settings; chart filters are presentation controls, not data access restrictions.

Backend tests cover publication boundaries, stale writes, roles, invitation expiry/revocation, removal, legacy reports, immutable evidence, and custom-spec rejection. The original browser recording below predates team editing. A full cloud browser smoke test of invitation → editor save → owner publish is still needed before merging this feature branch.

The next planned work is running Harbor on separate machines from the browser, with a machine/worker connection flow similar to t3code. That execution layer is not part of this branch.

## Recording and smoke evidence

[Watch the 26-second browser recording](media/hosted-report-flow.mp4). [Machine-readable smoke results](evidence/hosted-report-smoke.json).

| Time | User action | Outcome |
| --- | --- | --- |
| 00:01 | Sign in | Open private workspace |
| 00:03 | Choose export and name report | Review sanitized data before saving |
| 00:06 | Save and reload | Report persists in cloud storage |
| 00:10 | Create and copy link | Enable anonymous read-only access |
| 00:13 | Open as recipient | Filter results and inspect trials |
| 00:17 | Revoke link | Keep the saved report, disable sharing |
| 00:19 | Reopen old link | Access is denied |
| 00:23 | Return to workspace | Saved report remains available to owner |

The recording uses the real application and database functions on a separate Convex cloud preview. WorkOS is replaced only in the test frontend with short-lived signed JWT identities, verified by that preview’s test-only public key. No production auth bypass is shipped. A second anonymous browser and another signed-in account verify access boundaries. The 15 smoke checks cover malformed imports, persistence, ownership, copy link, anonymous reading, filtering, live and fresh-visit revocation, re-sharing, mobile overflow, unauthenticated writes, and browser exceptions.

Production was separately checked for public routing and the WorkOS sign-in redirect. The external WorkOS credential-entry/callback round trip was not automated. Production currently uses the existing WorkOS staging environment; switching to a production WorkOS environment is a separate account configuration change.

## First-release boundaries

- Normalized Harbor JSON only: 1–500 trials, at most 750,000 bytes, up to 100 reports per account. Raw job folders, raw Harbor `result.json`, and Studio project/bundle files are not accepted.
- Generate an export from a Heval checkout with `bun run report path/to/harbor-job`. Upload the resulting `results/harbor/<job>.json`. The published CLI can inspect results locally; this release does not add CLI upload or a CLI JSON-export command.
- The server independently validates every import. It stores an allowlist of trial labels, outcomes, timings, usage, cost, and selected provenance fields. Configuration, local source paths, error text, logs, and unknown fields are discarded. Labels can still contain sensitive text, so review them before sharing.
- Imported evaluation data remains immutable. Chart drafts, saved views, presentation settings, and report titles can be edited in hosted Studio. Deleting reports, uploading existing Studio bundles, and cloud evaluation execution remain future work. No model calls or Docker compute are required to import, edit, or view results.
- Sharing tokens live in the URL fragment, so they are not sent to Vercel as request paths or referrers. Every data read checks the active token in Convex; there is no public storage-file URL that can outlive revocation.

## Deployment

The connected project is `matthew-feroz:heval`. Production uses `industrious-newt-432`; development uses `fortunate-octopus-977`. The smoke preview is separate and expires after one day.

Vercel’s Production environment has `VITE_WORKOS_CLIENT_ID` and a secret `CONVEX_DEPLOY_KEY`. `scripts/vercel-build.ts` deploys Convex and supplies the matching `VITE_CONVEX_URL` to the Vite build. Convex production and development each have `WORKOS_CLIENT_ID`, matching the browser’s existing WorkOS application. No WorkOS API key is required by this JWT-verification integration.

For a new environment:

1. Run `bunx convex login`, then `bunx convex dev` to connect a project. Commit generated bindings, never `.env.local`.
2. Set `WORKOS_CLIENT_ID` in the selected Convex deployment and the matching `VITE_WORKOS_CLIENT_ID` in the frontend build.
3. Register the exact frontend origin in WorkOS’s allowed web origins and callback URLs; the callback is the origin root. Register `/login` as the sign-in URL.
4. Put a production Convex deploy key in **Vercel → Production → CONVEX_DEPLOY_KEY**. Do not expose it with a `VITE_` prefix. Use separate deployments and keys for previews.
5. Deploy with the checked-in Vercel build configuration. Keep Vercel **Standard Protection**: production aliases must be public for anonymous report links, while preview/generated deployment URLs remain protected.

Without a Convex URL, `/reports` shows a storage-not-connected message instead of pretending data was saved. Local CLI viewing remains account-free.

## Reproduce the smoke test

```sh
bun run test:reports
bunx convex deployment create smoke-reports --type preview --expiration 'in 1 day'
bunx convex deployment token create heval-report-smoke \
  --deployment preview/smoke-reports --save-env /tmp/heval-smoke.env
HEVAL_SMOKE_ENV=/tmp/heval-smoke.env \
HEVAL_SMOKE_URL=https://YOUR-PREVIEW.convex.cloud \
  bun run test:reports:smoke
```

Use a disposable deployment: the script installs a test JWT issuer there. It refuses production deploy keys and requires the URL to match the key’s deployment. It does not modify production auth or inject an administrator key into the browser. Videos, screenshots, and a JSON check report go to `recordings/hosted-report-flow/`. Keep deploy-key files private and delete the temporary key when finished.

The production integration follows [Convex’s Vercel deployment guide](https://docs.convex.dev/production/hosting/vercel) and [WorkOS AuthKit integration](https://docs.convex.dev/auth/authkit/add-to-app). The isolated smoke identity uses Convex’s documented [custom JWT verification](https://docs.convex.dev/auth/advanced/custom-jwt).

## Studio sign-in gate

Every hosted Studio entry (`/studio` and `/studio.html`, including job, run, and
saved-report links) requires a resolved WorkOS session. The editor bundle and
its data requests start only after sign-in. Loading, signed-out, and
unconfigured-auth states never mount either editor. Sign-in keeps the complete
requested path, query, and fragment in AuthKit state; the existing callback
accepts only destinations on this origin. Signing out or losing the session
unmounts Studio.

This page gate complements the existing Convex membership checks and Bun bearer
token checks; it does not make intentionally published report files private.
Shared report links remain available through `/share`. The separately packaged
local CLI viewer does not use the hosted route and still works without login.
Browser tests inject sessions through files under `tests/fixtures/`, which are
excluded from production builds; there is no query parameter or storage flag
that bypasses authentication in the shipped app.
