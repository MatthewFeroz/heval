# One-command worker setup

This is an **unreleased CLI feature**. Published `@mattferoz/heval@0.2.0` does
not include it. After a separately reviewed npm release, the entry point is:

```sh
npx @mattferoz/heval@latest setup
```

The `@` matters: `npx mattferoz/heval` refers to a GitHub repository, not the
scoped npm package. A future `nightly` tag can select a preview release; this
PR does not publish a package, create that tag, or deploy the website.

With a build from this branch, install the packed `.tgz` and run `heval setup`.
Users of the published package will need only Node.js 22+ and npm to launch it;
they do not clone the repository, install Bun, or build the frontend.

## Walkthrough

1. Run setup in your normal terminal. It describes the installation and asks
   before granting a worker access to Docker. First-time downloads can take
   several minutes and several GB. Allocate 8 GiB RAM and 15 GiB free disk to
   Docker for a comfortable starting point (the minimum memory check is 4 GiB).
2. If Docker is unavailable, setup offers the platform package manager:
   Winget on Windows, Homebrew on macOS, or apt on Ubuntu 24.04. Complete any
   OS approval, Docker Desktop first-run terms, virtualization/WSL requirement,
   or restart, start Docker, and run the **same command** again. It cannot
   bypass firmware settings or OS permissions. Other Linux distributions and
   Macs without Homebrew get an actionable prerequisite step.
3. Setup builds a persistent Linux worker from the installed package, with
   digest-pinned base images and pinned Python dependencies. Docker caches the
   runtime layers. Harbor, Python, Node, Docker CLI and Compose live inside
   that worker. Harbor installs each selected harness inside its disposable
   task container when an evaluation starts. Heval does not install standalone
   harness CLIs on the worker or host.
4. The local browser opens. Sign in to Heval's Machines page, create a pairing
   code, and paste its deployment URL and code into the local form. Pairing
   starts the outbound runner automatically. A previously paired worker keeps
   its account connection.
5. Paste the **model-calling Merge Gateway key** into the masked local field.
   Verification fetches the model catalog without calling a model. Choose a
   model and harnesses to prepare one-task profiles. Existing profiles are
   preserved; setup never silently changes approved evaluation settings.
6. In Machines, select this worker and click **Run setup check**. This runs
   Oracle without model credits and saves the report to your account. Then
   use Evaluations to start a model evaluation, which does use provider credits.

Setup prepares the bundled connection check, not every benchmark dataset.
The existing explicit benchmark installation workflow still applies to TBLite.

The local model/provider form uses the homepage's nine-harness catalog and icons.
Choose only the harnesses you want to evaluate, or preselect them from a terminal:

```sh
heval setup --harnesses codex,pi
heval setup --harnesses all
# On an existing connected Linux worker:
heval runner setup --model MODEL_ID --harnesses all
```

`all` means all six supported Merge adapters: Codex, Claude Code, OpenCode, Pi,
Grok Build, and Deep Agents. Selection prepares approved profiles and makes no
model calls. Harbor installs the pinned harness in each task container when the
user launches a run. No separate harness installation step is required.

Cursor, Antigravity and DeepSeek Harness remain visible with disabled choices
and specific blockers. Cursor needs its own account and a verified custom
provider route; Antigravity needs a verified Gemini-compatible route; DeepSeek
Harness has a known reasoning/streaming-tool incompatibility. Heval does not
represent these as runnable just because Harbor knows a harness name.

Grok uses Harbor's built-in adapter. Deep Agents uses the bundled adapter for the
official `deepagents-code` CLI; native logs and grades are retained, while
normalized trajectories and token/cost accounting remain unavailable. Run each
connection check before a full study.

The bundled connection fixture allows 1 GiB of memory. The old 256 MiB fixture
can leave OpenCode swapping during startup. Existing approved profiles are
preserved; create a fresh worker/profile to use the revised fixture. TBLite
task files and their declared budgets are unchanged. Docker applies Harbor's
automatic resource policy: enforce declared values and accept omitted values.

## Platforms and lifecycle

The worker always runs Linux. Hosts can use a standard local Docker Engine or
Docker Desktop in Linux-container mode. Windows also discovers Docker in WSL2;
`--distro Ubuntu-24.04` selects a particular distribution. Remote Docker
contexts, rootless data roots, and Windows containers are rejected.

The default container is `heval-worker`; its persistent named volume is
`heval-worker-data`. `--name heval-another` provisions a separate worker and
volume. The worker is UID 1000, with the Docker socket's supplementary group.
Docker access is powerful: it permits creating containers on that engine.
The worker uses neither privileged mode nor host networking and publishes no
ports. Its paths match the daemon's named-volume paths so sibling task
containers see the same files.

Docker's `unless-stopped` policy restarts the worker with the engine. Docker
Desktop must start at login if that is desired. For a WSL engine, setup creates
a hidden Windows login shortcut and a deduplicated WSL keepalive under
`%LOCALAPPDATA%/Heval/workers/<name>`. WSL services alone do not keep the distro
alive. Disable the shortcut in Windows Startup Apps when retiring that worker.
Keep the computer awake during evaluations.

Rerun setup to reopen its local UI; closing it leaves the worker
running. Keys and pairing credentials stay in the Linux volume with private
permissions, never in command arguments or the hosted frontend. The local
form binds to 127.0.0.1, requires a random capability, rejects cross-origin
writes and rebinding hosts, and clears the key field after submission. With
a Docker worker, local RPC sends secrets over Docker exec stdin only.

Stop a worker with `docker stop heval-worker` (prefix with the selected WSL
Docker command on Windows). Resume it by rerunning setup. To upgrade to a
different artifact, finish evaluations, stop and remove **only the container**,
then run the new setup command with the same name. Keep the volume. Setup
refuses to replace a different artifact or adopt unlabelled Docker resources.
Revoking a worker's account connection remains an explicit action in Heval.

## Coding agents and CI

```sh
npx @mattferoz/heval@latest setup --plan --json
npx @mattferoz/heval@latest setup --yes --no-browser
```

The first command is read-only and returns a versioned plan. The second
accepts installation/Docker access and prints the local setup URL; it does
not supply credentials or authorize paid evaluations. An agent can install
and diagnose the environment while the user completes sign-in, OS dialogs,
and secrets in the browser. Noninteractive setup requires `--yes`; failures
exit nonzero and leave resumable state.

`bun run cli:setup:smoke` installs the packed npm artifact outside the repo,
creates an isolated worker, verifies its non-root runtime and no published
ports, executes Oracle to 1/1 passed, checks the form in Chromium at mobile
width, restarts/resumes the same container, rejects stale capabilities and
artifact drift, and deletes only its own test resources. CI runs it on Linux
x64 and ARM64. The separate connected-evaluation test covers cloud pairing,
report upload and combined evaluations. Windows/WSL is additionally exercised
on the development machine; macOS Docker Desktop requires release QA on a Mac.

## What we learned from T3 Code

Research is pinned to upstream commit
`e4eb9977f0b02b29cb2ee361b0c433c685e87615` rather than a moving branch.

- [npm platform packaging](https://github.com/pingdotgg/t3code/blob/e4eb9977f0b02b29cb2ee361b0c433c685e87615/scripts/build-npm-platform-packages.ts):
  T3 generates a small CommonJS launcher with exact-version optional
  dependencies selected by OS/CPU. It executes a prebuilt platform binary.
  Native dependencies ship inside the platform tarballs; declaring bundled
  dependencies prevents npm from pruning them on a later install.
- [CLI build and publication](https://github.com/pingdotgg/t3code/blob/e4eb9977f0b02b29cb2ee361b0c433c685e87615/apps/server/scripts/cli.ts):
  T3 packages the web client alongside the server and validates executable
  imports. It publishes platform tarballs first and the launcher last, so
  users cannot resolve a launcher before its executables are available.
- [release workflow](https://github.com/pingdotgg/t3code/blob/e4eb9977f0b02b29cb2ee361b0c433c685e87615/.github/workflows/release.yml):
  separate preview/nightly/stable channels, serialized publishers, resolved
  source commits, artifacts, and npm provenance make releases deliberate.
  Manual stable releases build the commit already shipped by a nightly.
- [service launcher](https://github.com/pingdotgg/t3code/blob/e4eb9977f0b02b29cb2ee361b0c433c685e87615/apps/server/src/cli/serviceLauncher.ts):
  the persistent service has a stable installed executable and owns shutdown;
  its lifetime is independent of the interactive launcher.

Heval adopts the relevant properties: a prebuilt web/CLI npm artifact, no
runtime npm dependency resolution or postinstall script, artifact-level smoke
tests, an explicit setup operation, a runtime outside the temporary npx cache,
and persistent data separate from versioned code. Unlike T3's native app,
Harbor requires Linux and Docker, so Heval uses one portable Linux worker
recipe instead of six native executables. The first build downloads Python
dependencies; it is not instant and not offline. A future prebuilt OCI release
could shorten that cold start, but would need its own authorized publication,
provenance, platform tests and digest pin. This PR does not pretend such an
image or npm nightly channel is already published.
