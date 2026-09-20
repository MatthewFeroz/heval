# Run an experiment from the website

Open **Evaluations** in the workspace navigation. Once a worker is paired and
configured, no agent session or deployment credentials are needed to launch work.

All selections appear on one configuration page with a live run summary; there
are no Continue steps. Advanced settings start collapsed.

1. Choose an online worker and one of its installed task sets.
2. Select one or more harnesses.
3. Select models and a serving vendor. Change attempts under **Advanced settings**. Heval shows unsupported
   combinations and prevents launching an incomplete matrix.
4. Name the experiment, review every combination and its run deadline, then click
   **Start experiment**. This can incur inference charges.
5. The saved experiment page tracks all child runs. Return through Evaluations
   after closing the tab. Each run starts collapsed with its status and recorded passes visible.
   Expand it for timing, token counts, harness version, reported cost and its private report link.

The MacBook smoke worker advertises Codex, Claude Code and Pi with DeepSeek V4.1
Flash through particle, on the installed protocol-smoke task. Repeating that study
is a browser workflow. Installing a different dataset or adding a model/provider
connection still happens on the worker; the page does not promise arbitrary
catalog models or provision machines. This is a compatible-options picker, not a
shell-command editor. The tiny setup task is not a capability benchmark.

## Worker approval and compatibility

The source-built CLI now publishes task-set content hashes, serving-vendor labels
and maximum approved attempts. `maxAttempts` is an optional descriptor field in
profiles.json; it defaults to that profile's existing attempt count. The worker
validates it and incorporates it in the profile digest. Credential files, commands,
API base URLs and filesystem paths remain local. The current vendor label comes
from the configured `HEVAL_VENDOR`; absent a pin it reads "Provider default".
This label is configuration, not proof of the vendor served by each request.

Old workers still support individual runs, but do not advertise enough information
for the wizard. Upgrade the CLI once; the wizard then uses the approved options.
Profiles refresh during normal polling. A changed executable configuration or task
snapshot invalidates previously reviewed selections.

Each experiment chooses profile IDs and digests plus a bounded attempt override.
The backend verifies ownership, online status, common task snapshot and vendor,
distinct combinations, and the entire experiment's queue/report capacity in one
transaction. Limits are 10 combinations and 60 total trials, with the existing
10-active/queued and 200-run workspace limits. Each worker runs one trial at a time.
A stable submission ID makes retries idempotent; edits require a new ID.

On claim, the worker checks the profile digest and independently validates the
attempt override before copying tasks and writing the Harbor config. Backend
result validation checks the requested trial count rather than the profile's
original default. Each completed child run saves a private report under the
experiment owner's account. Cancel stops queued runs and requests acknowledgment
from the worker for active runs. Offline workers are not silently replaced.

## Data and scope

`experiments` stores ownership, title, submission identity and immutable selection.
`runnerRuns` stores the parent experiment and requested attempts. Existing reports
and old individual runs are retained. They are not silently grouped or re-executed.
The experiment page is a stack of expandable run summaries; it does not merge trial data into
a new presentation or implement cross-harness social charts.

Cost is still harness-reported and not reconciled with Merge billing. Unknown costs
remain unknown. Successful-task median time excludes failed trials and setup;
it should not be mistaken for end-to-end latency.

## Validation

- Convex tests cover ownership, atomic creation, idempotency, stale options,
  incompatible task sets, attempt bounds, capacity, results and cancellation.
- CLI tests verify attempt overrides cannot exceed worker approval and that the
  resulting task snapshot retains the requested number of attempts.
- `bun scripts/evaluation-ui-smoke.ts` exercises the actual browser components with
  simulated auth/Convex transport: choice cards, unsupported combinations, review,
  submission, reload, result links and cancellation. No inference is used.

Live validation on 2026-09-17 used the paired Mac worker and an Oracle-only
experiment (no model inference). A duplicate submission returned the same
experiment, the worker honored two requested attempts, both passed, and the
private report appeared in the experiment. The updated Mac worker advertises
all three verified model profiles with a maximum of three attempts per task.
