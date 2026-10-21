# A reproducible no-model Oracle example

This example checks the bundled task, Docker execution and report normalization.
Oracle writes the reference solution; it makes no model calls and needs no
provider credentials. A pass is a setup result, not a model benchmark score.
The separate [hosted acceptance checklist](sprint-1-acceptance.md) checks sign-in,
pairing, report navigation and sharing.

## Prerequisites and version record

Use a clean, reviewed checkout on a Linux worker with Node 22 or newer, Python
3.12, working Docker Engine/Compose and the Harbor version in
[`harbor/toolchain.json`](../harbor/toolchain.json). Build with the Bun version in
`package.json`. Follow the existing [installation guide](first-evaluation.md)
for missing prerequisites. Do not upgrade an active worker to run this example.

Record `git rev-parse HEAD`, `git status --short`, `bun --version`,
`node --version`, `harbor --version`, `docker version` and
`docker compose version` in a private evidence directory. Record the exact
installed CLI artifact and its SHA-256 when testing a tarball. A printed package
version alone cannot distinguish an unreleased source build from npm 0.2.0.
Current source requires Harbor 0.24.0; npm CLI 0.2.0 requires 0.23.0.

## Create an isolated approved profile

Run from the repository root. These commands create a new local evidence/state
directory and use the existing Oracle profile loader. They do not read, pair or
modify the normal runner state.

```sh
bun install --frozen-lockfile
export ORACLE_EVIDENCE="$PWD/.scratch/oracle-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$ORACLE_EVIDENCE"
bun -e '
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { initializeProfiles, loadProfiles, snapshotProfile } from "./packages/cli/src/runner/profiles";
const evidence = process.env.ORACLE_EVIDENCE;
if (!evidence) throw new Error("Set ORACLE_EVIDENCE first");
const registry = initializeProfiles(join(evidence, "state"), join(process.cwd(), "packages/cli/runner-task"));
const profile = loadProfiles(registry).find(p => p.public.id === "heval-setup");
if (!profile || profile.public.agent !== "oracle") throw new Error("Expected only the Oracle setup profile");
snapshotProfile(profile, join(evidence, "run"));
writeFileSync(join(evidence, "approval.json"), JSON.stringify({
  profile: profile.public,
  taskContentHashes: profile.taskHashes,
  taskExecutionMetadata: profile.taskExecutionMetadata
}, null, 2));
'
harbor run --config "$ORACLE_EVIDENCE/run/harbor.json" --print-config
```

Inspect the resolved configuration before execution. It must contain one Oracle
agent, one task, one attempt, concurrency 1 and no execution-error retries. The
approved overall budget is 300 seconds. Task limits are 60 seconds for the agent,
30 for verification and 120 for image build, with 1 CPU and 1024 MB memory.
The direct Harbor command below does not use the connected supervisor's overall
deadline; its task limits still apply. The connected path enforces that deadline.

## Execute, normalize and inspect

```sh
harbor run --config "$ORACLE_EVIDENCE/run/harbor.json"
bun -e '
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { exportJob } from "./harbor/report/trials";
import { parseReport } from "./src/reports/format";
const evidence = process.env.ORACLE_EVIDENCE;
if (!evidence) throw new Error("Set ORACLE_EVIDENCE first");
const raw = exportJob(join(evidence, "run/jobs/evaluation"), null, { verifiedOnly: true });
if (raw.rows.length !== 1 || raw.rows[0].agent !== "oracle" || raw.rows[0].passed !== 1 || raw.rows[0].error)
  throw new Error("Expected one completed, passing Oracle trial; inspect the raw job locally");
writeFileSync(join(evidence, "oracle.sanitized.json"), JSON.stringify(parseReport(JSON.stringify(raw)), null, 2));
'
```

Build the CLI with `bun run cli:build`, then inspect the completed job with
`node packages/cli/dist/cli.js open "$ORACLE_EVIDENCE/run/jobs/evaluation" --no-browser`.
Opening the report launches no evaluation. A hosted import can use the sanitized
JSON after reviewing its exact saved data.

The expected normalized outcome is one row with `agent: "oracle"`, `reward: 1`
and `passed: 1`. This is an expectation to verify, not a stored measurement.
The task checks that `/app/hello.txt` contains `hello from heval` and a newline.
Keep the actual generated report, verifier outcome and failure logs from the run.
Do not substitute the synthetic report-sharing fixture for execution evidence.

## Preserve provenance without exposing worker data

Keep a private run record alongside the generated files:

- Source revision and dirty-state status; exact CLI artifact digest, Node, Bun
  and Harbor versions; validation date and commands.
- `approval.json` profile digest, task-set/content digests and execution-metadata
  digests. Harbor's own task checksum is a separate field; do not equate them.
- The resolved configuration, attempts, concurrency, retry policy, task limits,
  observed harness version, actual job/trial IDs and recorded verifier outcome.
- Image references and observed immutable IDs/digests where available. The
  bundled Dockerfile uses mutable `python:3.12-slim`; a later tag inspection does
  not prove which image executed. Unrecorded image identity remains unknown.
- Raw-artifact location, responsible operator, retention period and backup
  decision. Record the local path privately; publish generic paths only.

Oracle has no inference model/vendor. The normalizer may emit `unknown` for its
model label. Missing harness versions, timing, tokens or billing remain null or
unknown; no-model execution does not justify fabricating zero cost in a report.
For model-backed runs, a configured vendor label is not proof of every served
request. Model aliases, image tags and harness installation dependencies can
change independently of the Heval source revision.

Raw configuration, credentials and logs remain on the worker. Convex receives
sanitized reports and monitoring snapshots, not a raw-artifact archive. The
operator owns raw retention and recovery. Sanitization drops local source paths,
configuration and raw error/log fields, but labels still need human review before
publication. Keep private files out of Git, public wiki pages and screenshots.

## Acceptance record

Only label this example **measured and verified** after the real Harbor/Docker
run and assertions pass. Record any unavailable prerequisites and keep the issue
open when execution or public-checkout validation is missing. The
[release checklist](publishing-cli.md#coordinated-release-evidence-and-rollback)
separates source checks from installed-worker, deployment and publication checks.

The [October 20 worker check](evidence/worker-upgrade-2026-10-20.md) records four
measured Oracle runs across the registry package, source upgrade and rollback.
Its local authentication does not establish hosted Clerk acceptance.
