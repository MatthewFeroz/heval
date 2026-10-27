# Publishing the OpenEval CLI

The npm package `@mattferoz/openeval` lives in `packages/cli`. Keep the repository root private.
The executable and UI are built ahead of publication; users only need Node.js.
It installs the `openeval` command and keeps `heval` as an alias for existing
scripts and services. `npx @mattferoz/openeval` runs `openeval` because that bin
matches the unscoped package name.

Releases up to 0.2.0 were published as `@mattferoz/heval`, because npm rejected
the unscoped name `heval` as too similar to `level`. npm also rejected the
unscoped `openeval` as too similar to the existing `open-eval` package, so from
0.3.0 the package is `@mattferoz/openeval`.

After 0.3.0 is published, deprecate the old package so its installs point here:
`npm deprecate @mattferoz/heval "Renamed to openeval. Run: npm i -g @mattferoz/openeval"`.

Under the old name, the initial version `0.1.0` was published with public access under the
`mattferoz` account. The registry tarball SHA-1 is
`9aaa6b1dd4dd96aca14c514f925120e08677ab30`, matching the tested release artifact.
The release currently uses `UNLICENSED` for OpenEval's own code.

Version `0.2.0` was published under the old name. Its registry tarball
SHA-1 is `ff8393ee421283e3ecc21395c7c29ae8dd9e3687`, matching the tested local
artifact. The fresh-cache registry installation and browser smoke checks passed,
including connected-runner command and asset checks. The package includes the
connected runner preview and full TBLite installation support; hosted frontend
and backend changes must still be deployed separately.

Version `0.3.0` was published as `@mattferoz/openeval` with the `latest` tag on
2026-10-27. Its registry tarball SHA-1 is
`c32f4fed03497f4bf4734fafcb6db3f8cfc08584`, matching the tested local artifact.
The fresh-cache registry installation and browser smoke checks passed on macOS.
It is the first release with `setup`. The Docker setup smoke and the x64, ARM64,
Docker Desktop and WSL setup checks were not run for this release.

## Prepare a release

1. Set the next version in `packages/cli/package.json`.
2. Build and check the package from the repository root:

   ```sh
   bun install --frozen-lockfile
   bun run cli:test
   bunx tsc -p packages/cli/tsconfig.json
   bun run cli:pack
   bun run cli:smoke
   bun run cli:setup:smoke
   ```

3. Inspect the tarball file list and the generated third-party notices. The
   package's `files` allowlist includes only `dist` and its package-check script,
   plus npm's standard manifest/README/license files. Build output is gitignored.
4. Commit release source changes. Do not commit the tarball.

Before releasing the setup command, require its x64 and ARM64 Docker/Oracle CI
jobs to pass and exercise Docker Desktop on macOS and Windows, plus WSL
keepalive/relogin. Refresh worker base-image digests and Python pins only with
these tests. Use a new package version: the published 0.2.0 cannot be replaced.
If a nightly channel is desired, publish an explicitly versioned prerelease
tarball under `--tag nightly` after the same checks; do not move `latest` for a
preview. Publication and hosted deployment require separate authorization.

The pack smoke test installs the actual tarball into a temporary project outside
the repository, invokes the installed executable, starts its HTTP server, and
checks real browser rendering and SVG/PNG/bundle downloads. It uses no model
credits. Install Playwright Chromium for this development check if necessary:
`bunx playwright install chromium`.

After publication, run `bun run cli:smoke:published` to repeat the walkthrough
against the registry release using a fresh npm cache and an empty npm user
configuration. It also checks trial inspection, filtering, bundle reimport,
mobile width, and raw Harbor/normalized JSON imports. It never launches an eval.

## First publication and ownership

Log in to the `mattferoz` npm account, with two-factor authentication
enabled. Run this in your own terminal; do not put account tokens in this repo.

```sh
npm login
npm whoami
npm view @mattferoz/openeval name version
```

A registry 404 means no public package was found, not a guaranteed reservation.
The first successful publication establishes package ownership.
Nothing in `cli:build`, `cli:pack`, or `cli:smoke` publishes or reserves a name.

Once the reviewed tarball is ready, publish that exact artifact (adjust version):

```sh
npm publish ./.scratch/mattferoz-openeval-0.3.1.tgz --access public --tag latest
npm view @mattferoz/openeval version bin
npx @mattferoz/openeval@latest --version
npx @mattferoz/openeval@latest open
```

Publishing the tested tarball avoids rebuilding between validation and upload.
OpenEval's own license is a maintainer choice; the initial scaffold leaves it
`UNLICENSED` until selected. Do not assume Harbor's license automatically
licenses OpenEval or third-party artwork. The shipped viewer includes no Merge
font files or generated branded posters.

## Later releases

Use a new package version for each release and repeat the pack/install/browser
checks. After the first publication, npm trusted publishing can connect this
package to a designated GitHub Actions workflow without a long-lived npm token.
Configure it in the npm package settings before adding an automated publisher.
The repository CI only builds and tests; it never publishes.

## Coordinated release evidence and rollback

Use this checklist for a reviewed source release. Package publication, public
source transfer and hosted deployment are separate authorized actions. Record
the actual deployed/installed revisions; a source commit or package version
does not establish that the worker, frontend and backend match.

- [ ] Select the reviewed source revision and exact tarball; record its SHA-256,
  Node/Bun/Harbor versions, contents and third-party notices. Preserve the
  sanitized public fixtures and branding exclusions. Transfer selected changes
  through a separate public checkout without private history.
- [ ] Require the applicable default CI jobs at that revision. Default CI covers
  functional/build checks, Node 22 installed CLI smoke and the real local
  connected Oracle path. Require the separate manual **Release checks** before
  CLI release or deployment/worker infrastructure changes; its Linux x64/ARM64
  setup, Node 24, deployment builds and legacy Docker checks are additional gates.
- [ ] Run `cli:pack`, `cli:smoke` and `cli:setup:smoke` on the exact artifact in
  its supported Node runtime. After an authorized npm publication, separately
  run `cli:smoke:published`; testing a local tarball does not test the registry.
- [ ] Record compatible frontend, Convex backend, Clerk configuration and worker
  versions. Follow [Clerk cutover/ownership instructions](clerk-auth.md) and any
  [report-summary backfill](report-summary-migration.md). Keep additive rollback
  compatibility until existing accounts, workers and reports are verified.
- [ ] Upgrade an idle worker only after its active evaluations finish. Preserve
  pairing, profiles, run state and private credential permissions. Install the
  reviewed artifact and its matching Harbor runtime; run doctor and a no-model
  Oracle check. Recheck changed approval digests before queued work is submitted.
- [ ] Complete the [hosted acceptance checks](sprint-1-acceptance.md): fresh
  sign-in, saved Oracle navigation, report roles, publication/revocation and
  authorized export downloads. Save sanitized evidence and remaining limitations.
- [ ] Before rollout, retain the compatible prior frontend/backend revisions and
  CLI tarball/runtime pair, plus operator-controlled backups and migration notes.
  Rehearse rollback on isolated state: return to that compatible pair, restart
  the daemon with its existing state, verify ownership/profile readiness and run
  Oracle. Confirm there is no duplicate execution. Do not downgrade an active
  supervisor, delete pairing/state or undo data migrations blindly.
- [ ] Link the [Oracle provenance record](reproducible-evaluation.md) and actual
  acceptance results from the public guides/wiki. Record raw-artifact retention
  responsibility; cloud reports and Blob presentation exports are not raw backups.

Keep every unchecked item visible. This is a procedure, not evidence that a
release, rollback or hosted acceptance was performed.

References: [npm publishing](https://docs.npmjs.com/creating-and-publishing-unscoped-public-packages/),
[trusted publishing](https://docs.npmjs.com/trusted-publishers/).

The [October 20 upgrade and rollback evidence](evidence/worker-upgrade-2026-10-20.md)
records the tested installed artifacts and compatible Harbor pairs. Hosted
acceptance and npm publication remain separate checklist items.
