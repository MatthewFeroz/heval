# Heval

Explore coding-agent evaluation results locally, without cloning the repository.
Heval includes a browser workbench and checks prerequisites for Harbor evaluations.

Requires **Node.js 22 or newer**. Viewing existing results needs no account, API
key, Bun, Docker, Python, or Harbor installation. There are no runtime npm
dependencies or install scripts.

## Start here

For the published local viewer:

```sh
npx @mattferoz/heval@latest open
```

This opens a synthetic example: six invented models across 20 tasks. It does not
start an evaluation or spend model credits. All example measurements are invented; they are not a model leaderboard.

For a permanent installation:

```sh
npm install -g @mattferoz/heval
heval open
```

## Open your results

```sh
# A normalized Heval export
heval open ./my-run.json

# A raw Harbor job directory containing per-trial config.json/result.json
heval open ./jobs/my-run

# Choose a port, or print the URL without launching a browser
heval open ./jobs/my-run --port 4173 --no-browser
```

By default Heval chooses an available port and listens on `127.0.0.1` only.
The terminal stays open while you use the viewer; press Ctrl+C to stop it.
Open the printed URL manually on systems without a browser launcher.

The viewer reads a snapshot of the selected results. To include trials that
finish later, stop and reopen it. Your input files are not modified. Raw Harbor
imports retain provider-reported costs; unavailable prices remain unknown.
Heval does not apply an unrelated pricing catalog from your current directory.

In the workbench you can:

1. Compare completion, cost, and duration with charts and tables.
2. Inspect individual trial results and recorded metadata.
3. Filter the comparison and download the chart as SVG or PNG.
4. Download a **Bundle** to share the workspace and its data.

Use **Open export** inside the viewer to open saved project/bundle files. A
referenced project may require its original sources; a bundle includes them.
Local links only work while the same viewer session is running. Imported files
stay in the browser unless you explicitly download or share them.

## Check evaluation setup

```sh
heval doctor
heval doctor --json
heval doctor --strict
```

Doctor checks Node, Harbor **0.23.0**, Docker daemon availability, optional Bun,
and known provider credential variable names. It never prints credential
values, installs software, or calls a model. Presence of an environment variable
does not verify account access, provider routing, or whether a particular job
has the right credentials. `--strict` returns a nonzero exit code when required
evaluation tools are missing or unsupported; otherwise missing tools are
informational because the viewer remains usable.

## Running evaluations

This first release supports **setup checks and viewing existing results**.
It does not yet include `heval run`, a job scheduler, live terminal replay, or
social/video rendering. SVG/PNG chart downloads run in your browser.

Use Harbor for execution, then open its output:

```sh
uv tool install harbor==0.23.0
harbor run -c ./your-job.yaml --print-config
# After configuring credentials and reviewing the job:
harbor run -c ./your-job.yaml
heval open ./jobs/your-job-name
```

Running Harbor requires the environment and credentials specified by your
job, and can consume model credits. See the
[Heval reproduction guide](https://github.com/MatthewFeroz/heval/blob/main/docs/reproducing-evaluations.md)
for existing comparisons and [Harbor documentation](https://www.harborframework.com/docs)
for execution concepts. Newer Harbor docs may describe features beyond the
version supported here.

## Build or install before npm publication

From the repository root:

```sh
bun install --frozen-lockfile
bun run cli:pack
npm install -g ./.scratch/mattferoz-heval-0.1.0.tgz
heval open
```

The tarball includes the compiled Node CLI, prebuilt browser UI, one synthetic
example, and bundled dependency notices. It excludes credentials, raw jobs,
corporate branding assets, and generated social media assets.

Until a project license is selected, Heval's own code is marked `UNLICENSED`;
bundled third-party components retain their licenses in
`dist/THIRD_PARTY_NOTICES.txt`. Harbor is a separately installed Apache-2.0 tool
and is not bundled.

## Connected runner preview

### One Merge Gateway key for Heval evaluations

The source-built preview supports Codex, Claude Code, OpenCode, and Pi through
Harbor 0.23.0. These commands do not change your standalone harness settings.
Use the same `--state /absolute/directory` on every command when overriding
the default `~/.heval/runner` state directory.

```sh
heval provider connect merge
# Paste the key at the hidden prompt; validation reads the Merge model catalog.
heval provider status merge
# Choose an exact model ID from the validated tool-capable models.
heval runner setup --model YOUR_MODEL_ID --harnesses codex,claude-code,opencode,pi
```

Setup creates four one-task smoke profiles without running models. A saved key
is shared by all profiles marked `"provider": "merge"`. No per-harness env files
are needed. Each profile keeps its own model selection; edit its JSON to change
that selection or its local task paths. Existing profiles are never overwritten.

To add a catalog benchmark instead of the one-task smoke, pass a checkout of its
pinned source. Setup verifies every task's content hash before copying it:

```sh
heval runner setup --benchmark tblite-smoke --source ~/.heval/benchmarks/openthoughts-tblite \
  --model YOUR_MODEL_ID --harnesses codex,claude-code,pi
```

On Linux with Harbor and Docker installed, test the full local execution path:

```sh
heval runner test --profile merge-codex
heval runner test --profile merge-claude-code
heval runner test --profile merge-opencode
heval runner test --profile merge-pi
```

**Each test makes real model calls and consumes credits.** It launches the
selected harness on the bundled file-writing task and checks the executable
grader result. It requires no website, sign-in, or pairing. A successful run
prints the results path for `heval open`; failed execution or grading exits
nonzero. Ctrl+C requests cancellation and waits for cleanup. If cleanup fails,
use `heval runner cleanup RUN_ID` with the same state directory before retrying.
This is a connection smoke test, not a capability benchmark or spending cap.

The same profiles appear on the connected machine after `runner connect` and
`runner start`. Keys stay on the machine; only profile metadata and normalized
results go to the hosted workspace. The local key is stored in `merge.json` with
0600 permissions (not encrypted). `provider status` never prints it. The supervisor
reads the current key when a run starts and injects only the selected harness's
credential variable. Generated profiles and execution metadata contain no key.
Raw third-party harness logs should still be treated as sensitive.

Re-run `provider connect merge` to validate and replace the key or refresh the
catalog. Failed validation preserves the old connection. Use
`heval provider disconnect merge` to remove the saved key; this blocks future
Merge launches but does not revoke the upstream key or stop already running jobs.
For automation, pipe a key from your secret manager into
`heval provider connect merge --key-stdin`; never put it in command arguments.

Harbor's OpenCode and Pi adapters use an `openai/` routing prefix in raw job
metadata, preserving the full Merge model ID after that prefix. Codex uses
Responses with WebSockets disabled; Claude uses Anthropic Messages; Pi uses
Chat Completions. Catalog validation does not prove every model works with every
harness: run the relevant smoke profiles to verify your chosen combinations.

This preview does not extend the separate Bun web workbench's Pi-only BYOK proxy.

The `0.2.0-preview.0` source build adds `heval runner connect`, `start`, `status`,
and `cleanup` for Linux machines with Harbor 0.23.0 and Docker. It is not yet
published on npm. Pair through the hosted Machines page, then keep the daemon
running to execute locally approved profiles and save results to your account.
The default Oracle setup check uses no model API calls. See the
[connected runner setup guide](https://github.com/MatthewFeroz/heval/blob/main/docs/connected-runners.md)
for tarball installation, credentials, a Linux service, and recovery.
