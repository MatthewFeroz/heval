# Vercel Sandbox worker backend

Status: planned, 2026-09-15. Not started. `docs/architecture.md` already names the intended progression as "local Docker → Daytona → optional Vercel Sandbox"; this plan implements the Vercel Sandbox step and skips Daytona.

## Outcome

`HEVAL_WORKER_BACKEND=sandbox` runs evaluations in Vercel Sandbox Firecracker microVMs instead of local Docker containers. The Docker backend stays and remains the default for local development. Nothing above `WorkerBackend` changes: `server/runner.ts` orchestration, `server/recording.ts`, the WebSocket stream, redaction, timeouts, capacity limits and the API are untouched.

The point is to decouple the control plane from the Docker socket. Once the runner no longer needs a local daemon, `server/index.ts` can be hosted on any platform that runs a Bun process, because the Sandbox SDK authenticates with an access token from non-Vercel environments.

## Reference and evidence

- [Vercel Sandbox overview](https://vercel.com/docs/sandbox) — Firecracker microVM per sandbox with its own filesystem and network; custom OCI images from Vercel Container Registry; system-privileged processes supported.
- [JS SDK reference](https://vercel.com/docs/sandbox/sdk-reference) — `Sandbox.create`, `runCommand`, `cmd.logs()`, `command.kill`, `sandbox.stop/delete`, `networkPolicy`, `createUser`, snapshots.
- [Pricing and quotas](https://vercel.com/docs/sandbox/pricing) — Pro: 8 vCPU / 16 GB max, 24 h max session, 10,000 concurrent. Hobby: 4 vCPU / 8 GB, 45 min session, 10 concurrent. Active CPU $0.128/hr, Provisioned Memory $0.0212/GB-hr, Creations $0.60/1M, Data Transfer $0.15/GB. 2 GB RAM per vCPU; vCPUs must be 1, or an even number 2–32.
- [Authentication](https://vercel.com/docs/sandbox/concepts/authentication) — OIDC token on Vercel, access tokens for external environments.
- [Container Registry](https://vercel.com/docs/container-registry) — where the custom worker image lives.
- Vercel publishes a guide for [running Terminal-Bench and Harbor benchmarks on Sandbox](https://vercel.com/kb/guide/run-terminal-bench-harbor-benchmarks-vercel-sandbox), which is the same workload shape as Heval's Harbor worker.

## Why the mapping is close

Every flag in `containerArgs` (`server/docker.ts:10`) has a direct counterpart, and two get stronger:

| `containerArgs` today | Sandbox equivalent |
| --- | --- |
| `--cpus=2 --memory=2g` | `resources: { vcpus: 2 }` → 2 vCPU / 4 GB. Memory is not independently settable. |
| `--network=none` on grade | `networkPolicy: 'deny-all'` |
| `--env HEVAL_GATEWAY_API_KEY` on run | `networkPolicy: { allow: { '<gateway host>': [{ transform: [{ headers: {...} }] }] } }` — the key stays on the control plane |
| `--mount type=volume,source=heval-$id` shared between run and grade | pull the single candidate file out of the run sandbox, write it into a fresh grade sandbox |
| `timeout --signal=KILL 3610s` | `timeout` on create, `sandbox.extendTimeout()`, plus the existing control-plane timer in `runner.ts:81` |
| `--user 1000:1000`, `--read-only`, `--cap-drop=ALL`, `--pids-limit`, `--security-opt` | the microVM boundary; in-sandbox separation via `sandbox.createUser()` |
| `docker rm -f` / `volume rm -f` | `sandbox.delete()` |
| piping `proc.stdout` / `proc.stderr` | `cmd.logs()` async iterator yielding `{ stream, data }` |

Two genuine upgrades over the current Docker setup:

1. **The gateway key never enters the worker.** Today it is passed with `--env` and scrubbed out of output by the redaction pass in `runner.ts:65`. With a `networkPolicy` header transform, the agent reaches the gateway without ever holding the credential. Keep the redaction pass anyway as defence in depth.
2. **The run phase can be domain-restricted** rather than fully open. Today the run container has unrestricted network.

## Current friction

1. `WorkerBackend.start` and `.grade` (`server/docker.ts:4`) are synchronous — they return `WorkerProcess`, not `Promise<WorkerProcess>`. `Sandbox.create()` is async. The sandbox backend must return a handle immediately whose `exited` wraps the whole async chain, and whose `stop()` is safe to call before the sandbox exists. The Docker backend already has this hazard and documents it at `server/docker.ts:54`.
2. `start` and `grade` are separate calls sharing only `id`. Docker bridges them with the named volume `heval-$id`. The sandbox backend needs its own `Map<string, SandboxState>` and must clear it in `cleanup`.
3. Grading deliberately runs in a **fresh** container (`server/worker/grade.ts:3`) so the agent cannot have replaced the pinned tests, the fixture, or `bun` itself. Reusing the run sandbox for grading would silently destroy that property. The grade sandbox must be created from the pristine image.
4. `grade.ts:5` guards against symlink escape by `realpath`-ing `/candidate/src/cache.ts` and requiring the `/candidate/` prefix. If the candidate is extracted by the control plane instead of mounted, the read happens inside the compromised filesystem and the check has to move with it.
5. `runner.test.ts:129` asserts on `containerArgs` output directly. Those assertions are Docker-specific and should stay pointed at the Docker backend, with parallel assertions added for the sandbox config object.
6. Error strings in `runner.ts:111` and `runner.ts:117` name Docker explicitly and will be wrong under the sandbox backend.

## Phase 0 — verify the three assumptions that would change the design

Do this before writing the backend. Each is cheap to test with the `sandbox` CLI against the published image.

- **Does a custom image's `USER` directive survive?** The Dockerfile sets `USER node` (`server/worker/Dockerfile:11`). If Sandbox starts commands as root regardless, the agent can tamper with `/opt/heval/worker` and grading integrity is gone. Fallback is `sandbox.createUser()` plus an explicit `chown`, running all agent commands as that user.
- **Is the root filesystem writable?** Docker uses `--read-only` with a tmpfs at `/tmp`. Sandbox gives 64 GB of ephemeral NVMe and full root access, so it almost certainly is writable. This decides whether `/opt/heval` needs protecting by ownership rather than mount options.
- **Does `networkPolicy` header transform work against the Merge gateway?** Confirm the gateway accepts an injected auth header and that the agent CLIs tolerate not having `HEVAL_GATEWAY_API_KEY` set. If any harness reads the env var directly and fails closed, fall back to passing it via `env` and rely on the existing redaction.

Record the answers in this file before proceeding.

## Phase 1 — publish the worker image

The existing `server/worker/Dockerfile` needs no changes in substance. It already pins `bun 1.4.0`, the four agent CLIs, the fixture and `worker/`.

1. Add `bun run worker:push` alongside `worker:build`, tagging into Vercel Container Registry.
2. Version the tag by content, not `:local` — the grade sandbox and the run sandbox must provably use the same image, and `--pull=never` has no analogue.
3. Set `HEVAL_WORKER_IMAGE` to the VCR reference. `runner.ts:157` already reads it.

Note the snapshot-storage implication: the image is large (node 22 + bun + four npm-installed agents). Persistent sandboxes snapshot on stop by default. Set `persistent: false` on both sandboxes — Heval has no use for resumption, and it avoids paying $0.08/GB-month for snapshots of throwaway workspaces.

## Phase 2 — `server/sandbox.ts`

New file implementing `WorkerBackend`. `server/docker.ts` is not modified.

```
type State = { run?: Sandbox; grade?: Sandbox }
const states = new Map<string, State>()
```

`start(id, harness, output)`:
- Synchronously build and return `{ exited, stop }`.
- Inside: `Sandbox.create({ image, resources: { vcpus: 2 }, timeout, persistent: false, networkPolicy, tags: { heval: 'worker', run: id } })`, store in `states`.
- `runCommand({ cmd: 'bun', args: ['/opt/heval/worker/main.ts', harness], cwd: '/workspace', detached: true })`, then drive `cmd.logs()` into `output(log.data)` for both streams. The existing `output` already handles interleaving and byte accounting.
- Resolve `exited` with `(await cmd.wait()).exitCode`.
- `stop()`: `cmd.kill('SIGKILL')` if the command exists, then `sandbox.stop()`; guard for being called mid-create by awaiting the create promise first and tolerating rejection.

`grade(id, output)`: see Phase 3.

`cleanup(id)`: `sandbox.delete()` on both handles, tolerate already-deleted, then `states.delete(id)`. `runner.ts:115` sets a global `cleanupFailed` latch on throw, so this must not be noisy about idempotent deletes — mirror the `allowMissing` behaviour at `server/docker.ts:29`.

## Phase 3 — grading isolation

This is the part that is easy to get subtly wrong. The property to preserve: *only the task solution crosses, and it is tested by pinned tests the agent never had write access to.*

1. In the run sandbox, run a small `extract` step that resolves `realpath /workspace/src/cache.ts`, rejects anything outside `/workspace/`, rejects over 1 MiB, and writes the validated bytes to a fixed path. This keeps the `grade.ts:5` check on the untrusted side of the boundary where it belongs, rather than trusting a control-plane read of a possibly-symlinked path.
2. `readFileToBuffer` that validated file to the control plane.
3. Create a **second** sandbox from the same pristine image with `networkPolicy: 'deny-all'`.
4. `writeFiles` the buffer to `/candidate/src/cache.ts`.
5. Run `bun /opt/heval/worker/grade.ts`, streaming through `output` exactly as the Docker path does.

`server/worker/grade.ts` then needs a small edit: it currently `realpath`s the candidate itself, which was meaningful when `/candidate` was an agent-written volume. With the file written by the control plane into a fresh microVM, the check is redundant there and belongs in step 1. Keep the 1 MiB guard in both places.

Do **not** take the shortcut of `sandbox.update({ networkPolicy: 'deny-all' })` on the run sandbox and grading in place. It is one line and it forfeits the entire guarantee.

## Phase 4 — configuration and wiring

- `server/runner.ts:156` becomes a backend selection on `HEVAL_WORKER_BACKEND` (`docker` default, `sandbox` opt-in), keeping `dockerBackend` as the fallback.
- New env: `VERCEL_TOKEN` (or `VERCEL_OIDC_TOKEN`), `VERCEL_TEAM_ID`, `VERCEL_PROJECT_ID`, `HEVAL_SANDBOX_REGION` (default `iad1`), `HEVAL_SANDBOX_VCPUS` (default 2).
- `server/index.ts:8` gates the runner on `HEVAL_ENABLE_RUNNER=1 && WORKOS_CLIENT_ID && HEVAL_GATEWAY_API_KEY`. Extend it to also require the Vercel token when the sandbox backend is selected, so a misconfigured deploy fails closed at boot rather than at first run.
- Generalise the two Docker-specific error strings at `runner.ts:111` and `runner.ts:117`.
- `HEVAL_RUN_TIMEOUT_MS` has a 3,600,000 ms ceiling (`runner.ts:152`), which exceeds Hobby's 45-minute session limit. Either require Pro or clamp the ceiling when the backend is `sandbox` and the plan is Hobby.
- `HEVAL_MAX_CONCURRENT_RUNS` defaults to 2 because a single Docker host is the constraint. Pro allows 10,000 concurrent sandboxes, so this can rise substantially — but the control plane still buffers all output in memory (`run.chunks`, `runner.ts:59`) and writes recordings to local disk, so raise it deliberately and watch memory.

## Phase 5 — tests

- `server/runner.test.ts` already injects a fake backend, so runner-level tests need no change. Keep the `containerArgs` assertions scoped to Docker.
- Add unit tests for the sandbox config builder, mirroring `runner.test.ts:129`: assert the grade config carries `deny-all`, that the run config does not mount or share anything with the grade sandbox, and that the gateway secret is absent from the sandbox env when the header-transform path is active.
- Add `server/sandbox.integration.test.ts` modelled on `docker.integration.test.ts`, gated behind a `VERCEL_TOKEN` env check so it skips by default. Add `test:sandbox` to `package.json`.
- Add one adversarial case: a run whose `src/cache.ts` is a symlink to `/etc/passwd` must fail extraction, not grade.

## Phase 6 — control plane hosting

Once Phase 4 lands, the control plane no longer needs Docker, and the hosting decision reopens on its own terms. `server/auth.ts` is stateless JWKS verification with no session store, so the only stateful dependency left is the recordings directory written by `server/recording.ts`.

That means any of the earlier candidates work. Render with a persistent disk is the least work; a small VPS is cheapest and keeps the Docker backend available as a fallback on the same box. Decide after the backend is proven, not before.

## Cost

A 10-minute run at 2 vCPU / 4 GB, assuming agent runs are I/O-bound on gateway calls so Active CPU is well under wall time:

- Provisioned memory: 4 GB × 0.167 h × $0.0212 = ~$0.014
- Active CPU at ~3 CPU-minutes: 0.05 h × $0.128 = ~$0.006
- Creation: negligible ($0.0000006 × 2)

Roughly **$0.02–0.04 per run** including grading. Pro's $20 monthly credit covers on the order of 500–1,000 runs before overage. Compare a VPS at a flat ~€5/month with unlimited runs but a fixed concurrency ceiling — Sandbox wins below roughly 500 runs/month and on burst concurrency; the VPS wins on sustained volume.

## Risks

- **Phase 0 assumption 1 is the load-bearing one.** If the image's `USER` is ignored and `createUser` cannot cleanly protect `/opt/heval`, grading integrity depends on the fresh-sandbox property alone. That is still sound — the grade sandbox is pristine — but the run sandbox's own tamper-resistance is weaker than the current `--read-only` container.
- Vendor coupling: `server/sandbox.ts` is confined behind `WorkerBackend`, so the blast radius is one file. Keep `dockerBackend` working and CI-tested rather than deleting it.
- The `main.ts` entrypoint copies the fixture into `/workspace` at startup (`server/worker/main.ts:8`). Confirm `/workspace` exists and is writable by the run user in the Sandbox environment; the Dockerfile creates and chowns it at build time (`Dockerfile:10`), which should carry over in the image but is worth asserting in the integration test.
