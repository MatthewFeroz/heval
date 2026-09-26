# Run Harbor from the browser on connected machines

The next CLI release includes [one-command setup](setup-command.md) for a
persistent Linux worker, account pairing, and a local masked provider-key form.
Published 0.2.0 still uses the manual commands below.

Heval CLI 0.2.0 includes the connected runner preview. The older npm 0.1.0 CLI does **not** contain these commands. Install 0.2.0 using the instructions below. The website and Convex backend must deploy compatible connected-runner code; installing the CLI does not update the hosted application.

```text
Browser on laptop / another browser session
                 │ WorkOS sign-in
                 ▼
      Hosted Heval + Convex workspace
       machines · queue · results
                 ▲
                 │ outbound HTTPS; no inbound ports
          ┌──────┴──────┐
     Linux PC        Cloud Linux VM
     Heval runner    Heval runner
       Harbor          Harbor
       Docker          Docker
```

Your browser doesn't need to stay open. Each machine runs a small polling daemon; a separate local supervisor owns each Harbor execution. Closing/restarting the polling daemon does not terminate that supervisor. The daemon reconnects to the same run and uploads its result once. A machine reboot interrupts execution; a run is never automatically repeated on another machine.

The current source pin is Harbor 0.23.0. It is covered by the required
connected-evaluation CI job, which runs the setup profile through a live daemon,
Harbor and Docker and verifies the resulting combined report. Older archived
manual smoke evidence may still record the Harbor version used when it was
captured.

New to this setup? Follow [Your first Heval evaluation](first-evaluation.md)
for a command-by-command walkthrough from a fresh Ubuntu worker to a saved result.

## 1. Install the preview on Linux

Use a dedicated Linux machine or VM you control, with Node.js 22+, Docker Engine and Compose available to your account, Python 3.12+, and Harbor **0.23.0**. The machine must have outbound HTTPS access to your Convex deployment and any image/model providers used by its tasks. The browser never receives access to the Docker socket.

Docker access grants substantial control of the host. This is a personal/trusted-worker architecture, not a public sandbox for untrusted users. Approve task files and agent configuration on the worker itself. Start with one task and one attempt.

Install the CLI on the Linux worker:

```sh
npm install -g @mattferoz/heval@0.2.0
heval --version
heval --help
```

Expect version `0.2.0` and `runner connect`, `runner start`, and `runner setup`
in the help output. Bun and a repository checkout are not required for the npm
installation. Use the same command to upgrade an older installation, after
active evaluations finish.

Alternatively, build the CLI from source (Bun is needed only for this build):

```sh
git clone --branch main https://github.com/MatthewFeroz/heval.git
cd heval
bun install --frozen-lockfile
bun run cli:pack
npm install -g ./.scratch/mattferoz-heval-0.2.0.tgz
heval --help
```

Alternatively, copy the built tarball to each machine and install it with `npm install -g /path/to/package.tgz`. No Bun dependency is required on those machines. Don't install a tarball over a different CLI version while a run is active.

With `uv` installed, install the pinned Harbor version:

```sh
uv tool install 'harbor==0.23.0'
harbor --version
docker info
docker compose version
```

The connected runner expects Harbor and its Docker engine on the same Linux machine. Use a separate runner on a remote VM; do not expose a public Docker TCP socket. [Docker's installation guide](https://docs.docker.com/engine/install/) and [Harbor installation](https://docs.harborframework.com/getting-started/installation) cover prerequisite setup.

## 2. Connect your computer

Runner setup presents four steps: **Set up your machine**, **Connect your
computer**, **Connect your model provider**, and **Run your first evaluation**.
With the setup-enabled CLI, `heval setup` prepares the worker and opens a local
page. Choose **Connect to Heval**, sign in, name the computer, and authorize it.
The browser returns to local setup to connect the provider. API keys stay local.

For an existing Linux worker, open Runner setup, choose **Setup is open**, then
**Use a pairing code instead**. Create a code and use the displayed deployment
URL with `heval runner connect --url https://YOUR-DEPLOYMENT.convex.cloud`.
Paste the one-time code when prompted. It expires after ten minutes. Start the
worker with `heval runner start` (or `--harbor /absolute/path/to/harbor`).

After connecting a model, **Run my first evaluation** checks Docker with the
free Oracle reference task, then starts the model task only if that check
passes. This model task uses provider credits. Results and run history live on
Evaluations; Runner setup manages computers and connections.

The daemon stores its credential, profiles, and runs under `~/.heval/runner` by default. Files containing connection state are written with mode `0600` inside a `0700` directory. Convex stores a digest of the credential. Use `--state /absolute/path` consistently when choosing another location. Pair each machine independently; do not copy `connection.json` to another host.

## 3. Approve a model-backed evaluation

The **Connect your model provider** step on Runner setup links to a worker-local
provider page. With an updated source-built CLI, run `heval provider setup merge`
on the worker. The page provides a masked key field, catalog validation, and
model/harness selection for creating connection-smoke profiles. No model calls
are made. Existing profiles are never overwritten. The hosted page accepts only
the local setup link, not the API key; neither that link nor the key is uploaded
to Convex. Use the same `--state` as the runner. See the
[browser setup instructions](first-evaluation.md#11-save-the-provider-connection-on-the-worker)
for WSL and SSH forwarding. Older npm builds retain the terminal flow below.

For Merge Gateway, the CLI can now create the connection and profiles for you:

```sh
heval provider connect merge
heval provider status merge
heval runner setup --model YOUR_MODEL_ID --harnesses codex,claude-code,opencode,pi
heval runner test --profile merge-codex
```

The hidden key prompt validates the catalog; setup makes no model calls. The
last command runs a real model-backed smoke test locally and uses credits.
No pairing is needed for local testing. Once paired, these same profiles are
available on the Evaluations configuration page. Use the same `--state`
directory throughout.
See [the CLI connection guide](../packages/cli/README.md#one-merge-gateway-key-for-heval-evaluations)
for replacement, removal, per-harness tests, and storage details. Merge profiles
use `"provider": "merge"` instead of `envFile`; mixing the two is rejected.

The browser can select only profiles advertised by its paired machine. It cannot supply shell commands, file paths, arbitrary Docker settings, or model keys. This release supports **explicit local Harbor task directories**, one agent/model per profile, configurable parallel trials and optional retries on execution errors (not failed verification scores). Task counts, trial counts, profiles per worker, and harness/model combinations have no fixed product caps. Counts and their totals must remain safe positive integers; each worker still explicitly approves the maximum attempts. Download/prepare benchmark tasks on the machine first. Unverified catalog versions, registry globs, multi-agent sweeps, and automatic cloud provisioning aren't offered as runnable choices.

### Catalog benchmarks

The Evaluations page lists task sets installed on the selected worker, using
`src/runners/benchmarks.ts` to identify pinned benchmarks by content hash. Add
benchmarks from the worker terminal. For example, the five-task OpenThoughts-TBLite smoke set:

```sh
git clone https://github.com/open-thoughts/OpenThoughts-TBLite ~/.heval/benchmarks/openthoughts-tblite
git -C ~/.heval/benchmarks/openthoughts-tblite checkout 5c37b41f00ce04719a4453061076ae9f46b74b7d
heval runner setup --benchmark tblite-smoke --source ~/.heval/benchmarks/openthoughts-tblite \
  --model YOUR_MODEL_ID --harnesses codex,claude-code,pi
```

Setup refuses tasks whose content differs from the pin. It copies them into the
runner state and creates one profile per harness and model. Run it again with
another `--model` to offer more models. Use `--benchmark tblite` with the same
source checkout to install the full 100-task set. Both TBLite entries are preview
benchmarks: their pinned content is installable, but a full Heval evaluation has
not yet validated them.

### Run deadlines

`timeoutSeconds` is the deadline budget for all tasks at the profile's configured
`n_attempts`. Custom profiles explicitly set this budget to cover their task set.
The browser and worker scale it by `requestedAttempts / n_attempts` (rounded up
to whole seconds). `maxAttempts` remains an explicit worker approval. There is
no two-hour ceiling; unsafe numeric values are rejected.

For catalog TBLite profiles, the base budget sums each task's agent, verifier and
build timeouts (600 seconds for an omitted build timeout), plus 1,800 seconds per
task for harness setup, environment restart, cleanup and orchestration. The full
set receives 611,080 seconds (about 170 hours) per attempt; the five-task smoke
set receives 21,000 seconds. These are conservative deadlines, not runtime
estimates or spending caps. Regenerate the checked-in hashes and budgets with
`bun scripts/pin-tblite.ts /path/to/pinned/OpenThoughts-TBLite`.

Upgrade the worker CLI along with the backend and frontend to use scaled
deadlines. Existing profile budgets stay as approved; re-create existing catalog
profiles or explicitly edit their budgets to adopt the new catalog defaults.

Add an entry to `~/.heval/runner/profiles.json` while retaining the setup profile:

```json
{
  "schemaVersion": 1,
  "profiles": [
    {
      "id": "heval-setup",
      "title": "Check this machine",
      "benchmark": "Heval setup check v1",
      "config": "setup.json",
      "timeoutSeconds": 300
    },
    {
      "id": "my-one-task-eval",
      "title": "My one-task evaluation",
      "benchmark": "My reviewed benchmark snapshot",
      "config": "one-task.json",
      "envFile": "/home/heval-worker/.config/heval/model.env",
      "timeoutSeconds": 600
    }
  ]
}
```

Create `one-task.json` alongside it, replacing the example model and task path with the combination you have verified:

```json
{
  "n_attempts": 1,
  "agents": [{ "name": "terminus-2", "model_name": "openai/YOUR-MODEL" }],
  "tasks": [{ "path": "/home/heval-worker/tasks/my-reviewed-task" }]
}
```

For manually configured providers, put the variables required by the Harbor agent in the local `envFile`, e.g. `OPENAI_API_KEY=...`, with restricted permissions. Never commit them. The supervisor deliberately does not inherit arbitrary credentials from the daemon's environment. Agent `kwargs`, `env`, and explicit setup/execution timeout overrides are accepted from manually configured JSON. Merge profiles generate routing and harness settings automatically and reject manual `kwargs`/`env` overrides. Supported built-in agents are Oracle, Codex, Claude Code, OpenCode, Pi, and Terminus 2; only the Oracle/Docker route has been exercised without paid credentials in the automated cloud smoke test. Model-backed combinations need your own compatibility/model-access check.

Task contents and executable configuration contribute to the profile digest. Each claimed run gets a copied task snapshot; a concurrent task edit aborts before execution. A changed profile cannot silently execute under an older browser selection. Identical profile metadata/configuration and task contents on two machines give the same digest despite different absolute task paths. Base image tags and provider model aliases may still change upstream; pin those yourself for published comparisons. Harness installation dependencies are not automatically frozen by Heval.

Model calls use the credentials on the selected machine. Its owner pays for model usage and VM resources. Time/trial limits are **not** dollar spending caps. The default setup check uses no model credits; a cloud VM may still incur compute charges.

## 4. Keep the machine connected

Copy [the user-service example](../deploy/heval-runner.service.example) to `~/.config/systemd/user/heval-runner.service`, and replace its paths with `command -v heval`, `command -v harbor`, and your home/state directories. Then:

```sh
systemctl --user daemon-reload
systemctl --user enable --now heval-runner
systemctl --user status heval-runner
journalctl --user -u heval-runner -f
```

Enable lingering for that dedicated account if the service must stay available after logout (`loginctl enable-linger USER`, with the privileges your distro requires). `KillMode=process` deliberately lets detached supervisors survive daemon restarts. Cancel active evaluations in the UI before intentionally shutting down the machine. Restart the daemon with the same state directory; keep the state disk persistent when replacing a VM.

The runner checks health every minute and polls every five seconds. Plan Convex usage accordingly; this is a small personal-worker implementation, not a fleet-scale event dispatcher.

## Sessions, moves, and failures

- **Another browser/device:** sign into the same Heval account. Machine state, queued/running jobs, and saved reports come from Convex. Team report invitations do not grant machine-execution access.
- **Move queued work:** choose a destination on that evaluation's card. It must be connected and advertise the exact profile digest. Once a machine claims the run it cannot move.
- **Daemon crash or network interruption:** the independent supervisor continues on that machine. The outcome is kept locally until reconnection. A new daemon session may wait up to 30 seconds for the previous connection lease to expire. Claims and report uploads are idempotent.
- **Host reboot, supervisor crash, or missing state:** Heval marks the run interrupted and does not rerun it. A cleanup marker blocks further execution on that runner. Inspect local logs, then use `heval runner cleanup RUN_ID --state STATE_DIRECTORY` to stop any matching orphaned Harbor process and remove only Compose resources belonging to that recorded run. Removing the marker by hand can hide orphaned work; use the command after investigation.
- **Cancel:** queued work cancels immediately. Running work shows cancellation pending until the machine acknowledges stopping and cleanup. An offline machine cannot be stopped instantaneously by the web client.
- **Switch off:** the switch in Runner setup stops a worker from claiming new runs; its current run finishes and queued work waits. Starting, enqueuing, or moving work onto it is refused until it is switched back on.
- **Machine icon:** the worker reports its host kind (laptop, desktop, Mac mini, Mac Studio, server, cloud VM, or Linux/WSL). `heval setup` detects it on the host because a container only sees Docker's VM; manual container recipes set `HEVAL_MACHINE_KIND`. Override it from the row's menu. See [`machine.ts`](../packages/cli/src/runner/machine.ts).
- **Disconnect:** the credential is revoked and queued work is cancelled. A connected daemon asks its current supervisor to stop; for an offline machine, inspect/stop its physical processes yourself. Reports remain saved.
- **Local evidence:** `heval runner status` shows run IDs without credentials. Raw Harbor logs are under `STATE/runs/RUN_ID/jobs/evaluation`, with supervisor output in the parent directory. Heval uploads only normalized/sanitized trial results, not raw logs or configuration. Treat raw local output as potentially sensitive.
- **Storage full:** successful local results stay on disk if the server rejects their upload. Do not delete the state directory to force a retry; recover the export locally with `heval open STATE/runs/RUN_ID/jobs/evaluation`.

Preview limits: 3 connected workers per owner (disconnect one to pair another), 200 evaluation records and the existing 100 saved-report limit. Reports retain a 750 KB document limit; there is no separate trial-row cap. If a combined report exceeds that size, individual run reports and completion state remain available. Live container migration, automatic retries/failover, VM provisioning, organization-wide worker sharing, and dollar budgets are follow-up work.

## Validation and deployment

`bun run test:backend` includes queue/ownership/claim tests. `bun run cli:test`
covers profile hashing, immutable copies, URL validation, private state, and
compatibility with Harbor's default-elided configs. CI also runs
`bun run test:evaluations:e2e`: it starts an isolated local Convex backend, a
separate live daemon process, Harbor and Docker; completes the bundled Oracle
task without model calls; and requires both the child report and combined
experiment report. Build the CLI before the broader manual cloud smoke:

```sh
bun run cli:build
HEVAL_SMOKE_ENV=/path/to/preview-key.env \
HEVAL_SMOKE_URL=https://YOUR-PREVIEW.convex.cloud \
HEVAL_SMOKE_HARBOR=/absolute/path/to/harbor \
  bun scripts/runner-smoke.ts
```

Use an isolated preview exactly as in [the report smoke instructions](hosted-reports.md#reproduce-the-smoke-test). The test installs its own short-lived JWT issuer there, uses real Convex functions and real Harbor/Docker execution, and must never target production. It exercises two separate runner state directories/processes on **one physical Linux host**; network reachability and firewall behavior on two actual physical machines remain a deployment check. Browser videos, screenshots and JSON evidence go to `recordings/connected-runner-flow/`. Revoke the temporary deploy key afterward.

The new frontend routes are `/machines` and `/evaluations`. Deployment uses the same Vercel + Convex + WorkOS configuration as saved reports. Merge/deploy matching frontend/backend revisions together. No paid cloud resources are provisioned by connecting a runner.


## Configuring execution in Evaluations

Updated workers advertise support for execution settings. In Evaluations, select
installed harness/model profiles, then open **Advanced settings**. You can set
parallel trials within each run, retries per trial error, CPU cores and RAM
(MiB) per trial, and a deadline in minutes for the whole harness/model run.
Attempts remain within the profile's locally approved `maxAttempts`.

The default remains one parallel trial and zero retries. Blank resource fields
preserve each task's requirements, and a blank deadline uses the profile's
attempt-scaled deadline. Resource overrides change benchmark conditions; the
review and saved run show them. Requested parallelism is a ceiling: a job with
one trial cannot occupy two slots. Different harness/model runs still execute
sequentially on one connected worker.

Choose concurrency using the Docker engine or VM allocation, leaving headroom
for its worker and other workloads. For example, two 4096-MiB task containers
request 8192 MiB plus overhead; the worker container's own memory limit does not
limit its sibling task containers. Heval does not automatically resize Docker
or reserve capacity. Provider rate limits also affect useful concurrency.
Retries can increase spending; neither the deadline nor concurrency is a dollar
cap. These controls do not impose a total task/trial count limit.

The browser request, backend queue, and isolated `harbor.json` snapshot retain
these settings. Backend and worker validation reject invalid settings and
requests targeting older workers, rather than silently running sequentially.
Deploy the updated Convex schema/functions first, then the frontend, and upgrade
the worker when idle. Older workers continue to use the existing default flow.
The new CLI's capability field requires the updated backend schema; installing
it alone does not update the hosted application. No deployment is performed by
building or testing this feature.

### Model prices

The eleven-model picker displays public Merge documentation prices without an API
key. Each rate card links to its source and shows when it was checked, including
published promotion, peak-hour, and long-context conditions. Refresh this snapshot
with `bun run models:refresh`; the importer fails rather than guessing if the
public table changes. Context limits retain the docs' rounded precision.

A newer catalog from the connected worker takes precedence for that model. Its
key stays local. Account availability comes from approved worker profiles, so a
published price does not enable a model or provider for execution. Explicit vendor
selections display that vendor's rate; automatic routing shows a labeled starting
rate. Provider token prices exclude Merge fees.

OpenRouter is a visual reference only; all rates come from Merge.
