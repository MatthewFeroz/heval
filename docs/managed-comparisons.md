# Managed comparisons on Railway and Daytona

The hosted beta uses a Railway coordinator and one disposable Daytona Linux VM
per comparison. Vercel continues to serve the website, Clerk handles sign-in,
and Convex owns the durable queue, worker claims, reports and baselines. The
same Harbor runner executes connected and managed evaluations.

Managed execution stays disabled until an operator configures it, approves a
worker snapshot, invites accounts and starts a coordinator. Adding these source
files does not deploy services, publish a worker image or make paid model calls.

## Accounts and responsibilities

Create Railway and Daytona accounts and enable the billing required by your
beta. Create a separate Merge Gateway project for managed evaluations with an
organization/project budget. The coordinator needs a Gateway management key to
mint short-lived, model-restricted keys. Keep management and Daytona credentials
only in the Railway service's runtime variables.

Railway is the job coordinator. Its non-privileged containers do not support the
Docker-in-Docker path used by this Harbor runner. Evaluations run in Daytona
Linux VMs with their own Docker engine. See
[Railway's limitation](https://docs.railway.com/guides/github-actions-runners),
[background workers](https://docs.railway.com/guides/cron-workers-queues), and
[Daytona Linux sandboxes](https://www.daytona.io/docs/en/linux-sandboxes/).

## Prepare the worker artifact

1. Build the CLI with `bun run cli:build` from the reviewed release revision.
2. Build `deploy/managed/Dockerfile.worker` for `linux/amd64`. This includes the
   pinned CLI/Harbor runtime and the pinned five-task TBLite subset. Test the
   artifact on Linux before approving it for a hosted run.
3. After explicit publication authorization, push that image to your registry.
   Retain its immutable `sha256` digest and third-party notices.
4. Register a **Linux VM** snapshot from the image's digest, with a unique
   versioned name. The coordinator requires 2–4 CPUs, 4–8 GiB RAM,
   and 20–40 GiB disk. Start with 4 CPUs, 8 GiB RAM and 30 GiB disk for the
   beta. The snapshot must include the supplied entrypoint, which starts Docker
   and makes its socket available to the non-root `heval` evaluation user.
5. Verify `docker info`, `docker compose version`, Harbor's pinned version, and
   the internal prepare/start commands in an isolated VM. Do not install keys,
   paired-runner state or completed jobs into the snapshot.

Daytona requires Linux VM snapshots to come from an existing image reference,
not a dynamic Dockerfile build. Use a registry image pinned by digest.
[Snapshot instructions](https://www.daytona.io/docs/en/snapshots/).

## Configure Convex

Set the following server-side variables in an isolated test deployment first:

```text
HEVAL_MANAGED_ENABLED=1
HEVAL_MANAGED_CONTROL_TOKEN=<64 random hexadecimal characters>
HEVAL_MANAGED_ALLOWED_USERS=<comma-separated invited owner identities>
HEVAL_MANAGED_POLICY_JSON=<approved policy JSON below>
```

Use the same control token on Railway. It is a service credential, never a
browser variable. The invited identity is the owner ID used by Convex, including
an existing ownership mapping if the account migrated between auth providers.
There is no wildcard enrollment. The beta allows one active comparison per
account, ten submissions per account per day, and one active comparison across
the deployment. Cleanup failures retain that global slot.

Example policy, with placeholders that must be replaced:

```json
{
  "snapshot": "heval-reviewed-release-v1",
  "benchmark": "tblite-smoke",
  "taskSet": "2683c14c21a9f9b797e0a576efd7993c5d5d15f54660a761c860c750a30bc762",
  "tasks": 5,
  "models": ["YOUR_EXACT_GATEWAY_MODEL_ID"],
  "harnesses": ["codex", "pi"],
  "maxBudgetUsd": 5,
  "maxMinutes": 30
}
```

One approved model enables harness comparisons. Approve two models to also
enable model comparisons. This policy does not change the benchmark catalog's
preview status: run the acceptance checks on the actual artifact first. New
submissions pin the policy's snapshot and task set; a later policy change does
not rewrite queued or completed comparisons.

## Configure Railway

Create a service from the reviewed repository. Keep the repository root as its
build context and select `/deploy/managed/railway.toml` as its configuration
file. It selects the coordinator Dockerfile, a health check and one replica.
Keep this worker always on. It uses Convex for durable state and needs no local
volume, Redis or separate database.

Set these Railway runtime variables:

```text
CONVEX_URL=https://YOUR-DEPLOYMENT.convex.cloud
HEVAL_MANAGED_CONTROL_TOKEN=<same secret as Convex>
DAYTONA_API_KEY=<dedicated sandbox-management key>
DAYTONA_TARGET=us
HEVAL_GATEWAY_MANAGEMENT_KEY=<dedicated mgmt_ credential>
HEVAL_GATEWAY_PROJECT_ID=<managed evaluation project UUID>
```

The coordinator has a `/health` endpoint. Startup fails for missing
configuration. Runtime errors use generic messages rather than provider bodies
or credentials. A recently connected coordinator makes managed execution
available only to invited accounts. Deploy the matching Convex and frontend
changes before enabling it.

## Execution, spending and recovery

Every submission contains a comparison question, approved harness/model choices,
model spend limit, deadline and explicit user authorization. The server validates
the matrix and reserves report capacity before accepting the work. A successful
worker preparation queues an Oracle check first. Models start only after that
check passes. Tasks execute sequentially, with one attempt and no automatic
trial retries.

The coordinator mints a per-comparison Gateway key restricted to the selected
models, project, expiry and monthly spending limit. It checks the returned scope
and restrictions before using the key. Keys cannot live across the monthly reset.
The global Gateway management key, Daytona key and control token never enter
the evaluation VM. See [Gateway key creation](https://docs.merge.dev/merge-gateway/management-api/api-keys/create-key).

The Gateway limit is a model spending threshold, not an exact invoice ceiling.
In-flight requests and provider accounting behavior can overshoot it, and cloud
compute is separate. Keep an independent project/organization budget. Validate
enforcement with the intended Gateway account before a paid launch. See
[Gateway budgets](https://docs.merge.dev/merge-gateway/cost/budgets).

The VM has an independent provider-enforced wall-clock TTL covering the selected
execution time plus ten minutes for setup and cleanup. Cancellation gives the
existing supervisor up to 90 seconds to save partial verified results. Model
access is then revoked and the VM deleted. Cleanup errors remain retryable and
keep the queue occupied. An unreachable coordinator is backed by the VM TTL and
the model key's expiry; operators must still inspect failed cleanup and billing.

A Railway restart reclaims the same durable job and named VM. Activated jobs
never provision replacement VMs or automatically rerun model work. A missing
original VM produces an interrupted result. Keep the control token stable while
jobs are active because it also derives their scoped runner identities.

## Results, baselines and evidence

All recorded run reports use the existing normalized format and publication
controls. Completed comparisons can become immutable baselines. Repeats keep
the task snapshot, attempts and execution settings. The result shows new or
omitted combinations, changed worker approvals and recorded harness versions.

Before VM deletion, the coordinator attempts to retain up to twelve bounded
verifier-output artifacts for acknowledged trials. Known model key strings are
redacted. Capture is best effort; missing output stays unavailable. Raw job
directories, trajectories and arbitrary files are not uploaded or backed up.
The ephemeral VM is deleted after the comparison.

Report owners can attach code patches or verifier text privately. Evidence is
immutable, hashed and bound to an actual trial. Its separate publication action
requires reviewing the complete text for private data. Chart publication never
publishes new evidence implicitly. Shared links show only explicitly published
evidence, and revocation stops subsequent public access to both. Evidence
publication changes independently of chart revision numbers.

## Required live acceptance

Before cloud acceptance, build and exercise the real worker locally:

```sh
bun run managed:worker:build
bun run managed:test:worker
```

The smoke check uses a temporary container with a private Docker engine,
anonymous image-storage volume and Docker's nesting wrapper. It runs the bundled
Oracle task through Harbor and requires one passing trial with no execution
errors. It makes no model calls and removes its container and volumes. The test
requires at least four CPUs and ten GiB of Docker memory, including overhead.
Production execution uses Linux VMs rather than this privileged test container.

Run the smoke image natively. On ARM64 development hosts, build the same recipe
for ARM64 and select that local test artifact:

```sh
docker build --platform=linux/arm64 -f deploy/managed/Dockerfile.worker -t heval-managed-worker:arm64-local .
HEVAL_MANAGED_TEST_IMAGE=heval-managed-worker:arm64-local bun run managed:test:worker
```

An AMD64 image build and an ARM64 Oracle pass do not validate an AMD64 cloud VM.
The provider checks below remain required on the actual release artifact.

- Prove the released image works as a Daytona Linux VM, including Docker startup,
  task hashes, harness installation and provider routing.
- Use an invited fresh account to complete Oracle and one bounded paid comparison.
  Reopen the saved report, inspect retained evidence, save a baseline and repeat.
- Restart Railway mid-run and verify the same VM, run IDs and model work persist.
- Cancel while provisioning and while running. Confirm partial reports, key
  revocation and actual VM deletion in provider dashboards.
- Force a cleanup failure and confirm the queue stays reserved until recovery.
- Check Gateway model/expiry/spend restrictions, organization budgets and cloud
  usage. This beta has no subscription billing or all-in spending guarantee.
- Verify real owner/editor/viewer/anonymous access, evidence publication and
  revoked links. Publish only reviewed source and artifacts through the separate
  public checkout.

Local tests cover source behavior and simulated provider boundaries. They do
not establish current cloud capacity, live account access, paid execution or a
public release.
