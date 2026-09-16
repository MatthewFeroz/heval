# Publishing the Heval CLI

The npm package lives in `packages/cli`. Keep the repository root private.
The executable and UI are built ahead of publication; users only need Node.js.

## Prepare a release

1. Set the next version in `packages/cli/package.json`.
2. Build and check the package from the repository root:

   ```sh
   bun install --frozen-lockfile
   bun run cli:test
   bunx tsc -p packages/cli/tsconfig.json
   bun run cli:pack
   bun run cli:smoke
   ```

3. Inspect the tarball file list and the generated third-party notices. The
   package's `files` allowlist includes only `dist` and its package-check script,
   plus npm's standard manifest/README/license files. Build output is gitignored.
4. Commit release source changes. Do not commit the tarball.

The pack smoke test installs the actual tarball into a temporary project outside
the repository, invokes the installed executable, starts its HTTP server, and
checks real browser rendering and SVG/PNG/bundle downloads. It uses no model
credits. Install Playwright Chromium for this development check if necessary:
`bunx playwright install chromium`.

## First publication and ownership

Log in to the npm account that should own `heval`, with two-factor authentication
enabled. Run this in your own terminal; do not put account tokens in this repo.

```sh
npm login
npm whoami
npm view heval name version
```

A registry 404 means no public package was found, not a guaranteed reservation.
The first successful publication establishes package ownership. If the name is
unavailable, select a scoped package name and update the release documentation.
Nothing in `cli:build`, `cli:pack`, or `cli:smoke` publishes or reserves a name.

Once the reviewed tarball is ready, publish that exact artifact (adjust version):

```sh
npm publish ./.scratch/heval-0.1.0.tgz --access public
npm view heval version bin
npx heval@latest --version
npx heval@latest open
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
