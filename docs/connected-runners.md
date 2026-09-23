# Run Harbor from the browser on connected machines

Heval's connected runner is available as a preview on `main`. The currently published npm 0.1.0 CLI does **not** contain these commands. Build/install the tarball from `main` until a new CLI release is published. The website and Convex deployment must use the same version.

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

## 1. Install the preview on Linux

Use a dedicated Linux machine or VM you control, with Node.js 22+, Docker Engine and Compose available to your account, Python 3.12+, and Harbor **0.23.0**. The machine must have outbound HTTPS access to your Convex deployment and any image/model providers used by its tasks. The browser never receives access to the Docker socket.

Docker access grants substantial control of the host. This is a personal/trusted-worker architecture, not a public sandbox for untrusted users. Approve task files and agent configuration on the worker itself. Start with one task and one attempt.

Build the CLI once from `main` (Bun is needed only for this build):

```sh
git clone --branch main https://github.com/MatthewFeroz/heval.git
cd heval
bun install --frozen-lockfile
bun run cli:pack
npm install -g ./.scratch/mattferoz-heval-0.2.0-preview.0.tgz
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

## 2. Pair and run the first check

1. Open **Runner setup** (`/machines`) in your Heval deployment and sign in.
2. Name the machine and click **Create pairing code**. The page shows the exact HTTPS Convex URL for this environment.
3. On the Linux machine, run the displayed `heval runner connect --url https://YOUR-DEPLOYMENT.convex.cloud`. Paste the one-time code when prompted. It expires after ten minutes and can pair one machine. Provider credentials are not involved in pairing.
4. Run `heval runner start`. If Harbor isn't on PATH, use `--harbor /absolute/path/to/harbor`. Keep it running or install the service below.
5. When the page says **Online**, click **Run setup check**. One local task runs in Docker using Harbor's Oracle reference solution. It makes no model API calls and is not a benchmark score.
6. Open the resulting **saved report**. Use Studio to change its chart, save the draft, and publish/share it through the existing report workflow.

The daemon stores its credential, profiles, and runs under `~/.heval/runner` by default. Files containing connection state are written with mode `0600` inside a `0700` directory. Convex stores a digest of the credential. Use `--state /absolute/path` consistently when choosing another location. Pair each machine independently; do not copy `connection.json` to another host.

## 3. Approve a model-backed evaluation

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

The browser can select only profiles advertised by its paired machine. It cannot supply shell commands, file paths, Docker settings, or model keys. This release supports **explicit local Harbor task directories**, one agent/model per profile, 1–60 total trials, one concurrent trial, no automatic Harbor retries, and a maximum two-hour job deadline. Download/prepare benchmark tasks on the machine first. Unverified catalog versions, registry globs, multi-agent sweeps, and automatic cloud provisioning aren't offered as runnable choices.

### Catalog benchmarks

The Evaluations page lists benchmarks from `src/runners/benchmarks.ts`. Each
installable entry pins its tasks by content hash. A worker that advertises the
same task-set hash shows the benchmark as installed. Otherwise, the card shows
the commands to add it. For example, the five-task OpenThoughts-TBLite smoke set:

```sh
git clone https://github.com/open-thoughts/OpenThoughts-TBLite ~/.heval/benchmarks/openthoughts-tblite
git -C ~/.heval/benchmarks/openthoughts-tblite checkout 5c37b41f00ce04719a4453061076ae9f46b74b7d
heval runner setup --benchmark tblite-smoke --source ~/.heval/benchmarks/openthoughts-tblite \
  --model YOUR_MODEL_ID --harnesses codex,claude-code,pi
```

Setup refuses tasks whose content differs from the pin. It copies them into the
runner state and creates one profile per harness and model. Run it again with
another `--model` to offer more models. Full TBLite (100 tasks) is listed for
reference but exceeds this release's per-evaluation limits.

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
- **Disconnect:** the credential is revoked and queued work is cancelled. A connected daemon asks its current supervisor to stop; for an offline machine, inspect/stop its physical processes yourself. Reports remain saved.
- **Local evidence:** `heval runner status` shows run IDs without credentials. Raw Harbor logs are under `STATE/runs/RUN_ID/jobs/evaluation`, with supervisor output in the parent directory. Heval uploads only normalized/sanitized trial results, not raw logs or configuration. Treat raw local output as potentially sensitive.
- **Storage full:** successful local results stay on disk if the server rejects their upload. Do not delete the state directory to force a retry; recover the export locally with `heval open STATE/runs/RUN_ID/jobs/evaluation`.

Preview limits: 20 paired-machine records per owner, 200 evaluation records, 10 queued/active evaluations per owner, and the existing 100 saved-report limit. Revoked machines still count toward the preview limit. Live container migration, automatic retries/failover, VM provisioning, organization-wide worker sharing, and dollar budgets are follow-up work.

## Validation and deployment

The [recorded browser walkthrough](media/connected-runner-flow.mp4) shows pairing,
dispatch, queued transfer, daemon recovery, results, and cancellation. The
[16-check smoke evidence](evidence/connected-runner-smoke.json) records the tested
versions and limits. No model calls or paid VM provisioning were used.

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
