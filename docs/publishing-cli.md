# Publishing the Heval CLI

The npm package `@mattferoz/heval` lives in `packages/cli`. Keep the repository root private.
The executable and UI are built ahead of publication; users only need Node.js.

npm rejected the unscoped name `heval` as too similar to `level`. The package
uses the maintainer's scope; its executable is still named `heval`.

The initial version `0.1.0` was published with public access under the
`mattferoz` account. The registry tarball SHA-1 is
`9aaa6b1dd4dd96aca14c514f925120e08677ab30`, matching the tested release artifact.
The release currently uses `UNLICENSED` for Heval's own code.

Version `0.2.0` is now published with the `latest` tag. Its registry tarball
SHA-1 is `ff8393ee421283e3ecc21395c7c29ae8dd9e3687`, matching the tested local
artifact. The fresh-cache registry installation and browser smoke checks passed,
including connected-runner command and asset checks. The package includes the
connected runner preview and full TBLite installation support; hosted frontend
and backend changes must still be deployed separately.

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
npm view @mattferoz/heval name version
```

A registry 404 means no public package was found, not a guaranteed reservation.
The first successful publication establishes package ownership.
Nothing in `cli:build`, `cli:pack`, or `cli:smoke` publishes or reserves a name.

Once the reviewed tarball is ready, publish that exact artifact (adjust version):

```sh
npm publish ./.scratch/mattferoz-heval-0.2.0.tgz --access public --tag latest
npm view @mattferoz/heval version bin
npx @mattferoz/heval@latest --version
npx @mattferoz/heval@latest open
```

Publishing the tested tarball avoids rebuilding between validation and upload.
Heval's own license is a maintainer choice; the initial scaffold leaves it
`UNLICENSED` until selected. Do not assume Harbor's license automatically
licenses Heval or third-party artwork. The shipped viewer includes no Merge
font files or generated branded posters.

## Later releases

Use a new package version for each release and repeat the pack/install/browser
checks. After the first publication, npm trusted publishing can connect this
package to a designated GitHub Actions workflow without a long-lived npm token.
Configure it in the npm package settings before adding an automated publisher.
The repository CI only builds and tests; it never publishes.

References: [npm publishing](https://docs.npmjs.com/creating-and-publishing-unscoped-public-packages/),
[trusted publishing](https://docs.npmjs.com/trusted-publishers/).
