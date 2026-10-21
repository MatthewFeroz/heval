# Worker upgrade and rollback, October 20, 2026

An installed worker must keep its pairing and approved profiles when its CLI
and Harbor runtime change together. This check ran the real Convex queue,
installed Node CLI, supervisor, Harbor and Docker task verifier on isolated
Linux state. Oracle applied the bundled reference solution without model calls.

The [sanitized record](worker-upgrade-2026-10-20.json) includes exact artifact
hashes, source revision, approval digests, run/report IDs, measured times and
health checks. It contains no connection credentials, account identities,
worker addresses, local paths or raw logs.

## Artifacts and observed results

Both packages identify themselves as CLI 0.2.0, so the artifact hashes matter.
The source tarball was built from public commit
`dd69e2b6506110f0b41772b0cab948c236666a8b`. The registry tarball requires Harbor
0.23.0; that source requires 0.24.0. Execution used Node 22.23.3, Bun 1.4.2,
Docker Engine 29.7.2 and Compose 5.5.0.

| Step | Installed artifact | Harbor | Verifier | Combined report | Total trial time |
| --- | --- | --- | --- | --- | ---: |
| Initial run | Registry package | 0.23.0 | 1/1 passed | Saved | 22.754 s |
| Idle upgrade | Source tarball | 0.24.0 | 1/1 passed | Saved | 22.047 s |
| In-place rollback | Registry package | 0.23.0 | 1/1 passed | Saved | 22.100 s |
| In-place re-upgrade | Source tarball | 0.24.0 | 1/1 passed | Saved | 22.469 s |

I inspected each raw `verifier/reward.txt` and its corresponding saved report.
All four rewards were `1`; each experiment completed and saved both a child
report and a combined report. Missing token usage and cost remain null.
These are setup results, not model performance measurements.

The existing `connection.json` and `profiles.json` were unchanged through the
transitions. The rollback preserved all 59 previously recorded files and added
25; the subsequent in-place upgrade preserved all 84 and added 26. The profile
digest changes between package generations because the newer approval contract
includes execution metadata. Pairing and task-set identity remain unchanged.

The first registry-to-source transition used a separately installed source
artifact with the same state. The later re-upgrade replaced the package in the
same installation directory. Each transition happened while the worker was idle.

## Compatibility and installed-package checks

- Matching CLI/Harbor pairs passed strict health checks. Provider credentials
  were absent and optional for Oracle.
- Registry CLI with Harbor 0.24.0 advertised not ready and instructed the
  operator to install 0.23.0. Source CLI with Harbor 0.23.0 required 0.24.0.
  A forced experiment request was rejected by the real Convex backend because
  the worker was not ready.
- Both artifacts rejected Node 20 with `Heval requires Node.js 22 or newer.`
- The source checkout passed 60 CLI tests, packed the tarball, and passed the
  installed-artifact smoke and setup smoke. The installed smoke used Node
  22.23.3 and exercised report inspection, downloads, bundle reimport and narrow
  layout. Setup smoke completed its own non-root Oracle run.

## Reproduction and limits

Use the [Oracle instructions](../reproducible-evaluation.md) and the
[coordinated release checklist](../publishing-cli.md#coordinated-release-evidence-and-rollback).
Install each exact tarball into its own prefix, retain one isolated runner state,
and select the matching Harbor binary. Stop the idle daemon before switching
packages, restart with that same state, wait for healthy status, then enqueue
one setup task. Repeat after restoring the registry artifact and Harbor 0.23.0.
Compare pairing/profile files and existing run artifacts before and after each
transition. Never copy another worker's connection file.

The preceding validation also executed the two shell blocks in the Oracle guide
against the public source checkout. Both commands exited successfully
and produced one passing normalized trial, with reward `1` and 8.351 seconds of
agent time. The record retains that run separately from the installed-worker
checks. The guide itself is not yet in that public checkout; this validates its
commands without claiming the documentation has been published.

Authentication here used an isolated local JWT issuer. This does not verify
production Clerk sign-in, fresh-account onboarding, public sharing, live-worker
upgrades or paid model execution. The four runs were initiated through an
operator script calling the actual Convex API, not through the hosted UI.
Docker image tags remain mutable; the executed image digest was not recorded.
The raw files and isolated state remain private on the validation worker for
follow-up review. No npm package was published and no shared worker was changed.

This record was first prepared during private validation and is now included
in the public source release. Public wiki links and remaining acceptance
criteria still need reconciliation. Issues #18 and #19 remain open until those
criteria are satisfied.
