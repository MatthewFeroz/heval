# Hosted Clerk acceptance, 2026-10-20

This check covers signing into an existing account, running a no-model worker
check on the hosted deployment, and controlling anonymous access to a synthetic
report. It adds hosted evidence to the earlier
[local walkthrough](first-evaluation-2026-10-03.md). Fresh-account signup and
teammate roles remain untested. This is not full release acceptance.

## Deployment and scope

The frontend used public source commit
`dd69e2b6506110f0b41772b0cab948c236666a8b` with explicit Bun 1.4.2 Vercel
install/build commands. The matching Convex backend was deployed. The run
database was not part of the deployment tested on this date.

The account owner selected their existing account and supplied an email sign-in
code. No new password or fresh account was created. The signed-in workspace
retained its existing workers and reports with owner access.

The preceding agent segment recorded the browser execution and sharing steps
below. After the handoff, the continuing agent independently reopened the saved
Oracle report, inspected its raw worker outcome and verifier reward, checked the
synthetic report's final saved state and row hash, inspected the anonymous
revocation screen, and disconnected the temporary worker. Intermediate sharing,
keyboard and narrow-screen observations are records from that preceding segment;
they were not repeated after the handoff.

## Real hosted worker check

Runner setup paired a separate worker named `Hosted acceptance 2026-10-20`
using isolated state. **Run worker check** dispatched Oracle through the real
hosted queue, Node daemon, supervisor, Harbor 0.24.0 and Docker. No provider key
or paid model call was used.

| Observation | Result |
| --- | --- |
| Raw verifier reward | `1` |
| Saved report | `j97e4aqwmnyabv1kmsfzacq02n8gmj87` |
| Hosted report readback | Owner access, version 0, 1 trial, 1 passed, public link off |
| Trial timing | Agent 8.397 seconds; total 22.323 seconds |
| Cost | Missing, represented as null |
| Model | Unknown; Oracle does not establish model performance |
| Persistence | Opened from setup, reloaded, revisited through Report library |
| Keyboard | Tab then Enter on the skip link focused `workspace-main` |
| Narrow view | At 390 CSS pixels, no horizontal document overflow; report remained usable |

Open the report at `HOSTED_ORIGIN/reports?id=j97e4aqwmnyabv1kmsfzacq02n8gmj87`
while signed into its owning account. The accompanying JSON records its run ID,
task checksum and timestamps. Raw artifacts remain private on the isolated
worker. This one setup trial is not a model ranking or a model-backed evaluation.

## Synthetic owner and anonymous sharing

The report imported from `tests/fixtures/report-sharing.json` was explicitly
labeled synthetic. Its report ID is `j977fw9krs6kvjxksx4h2b8chh8gn4mb`, with four
trials and two passes. No real evaluation result was published.

| Action recorded before the handoff | Observed result |
| --- | --- |
| Save privately, open without a session | Sign-in shown; report contents unavailable |
| Publish the initial draft | Anonymous read-only view showed version 0 and the initial synthetic title |
| Save a renamed draft in Studio | Owner saw version 1; anonymous refresh retained version 0 and its title |
| Explicitly publish the saved draft | Anonymous view showed version 1 and the new title |
| Revoke the first link | Fresh anonymous read showed **This link is unavailable** |
| Create a replacement link | Different token; replacement worked; old link remained unavailable |
| Revoke the replacement | Anonymous read showed **This link is unavailable** |

Final readback confirmed owner draft version 1, published version 1, public link
off, no joined teammates, and a null backend share token. The replacement link
still showed the unavailable screen in the anonymous browser. No share tokens
are included in this record.

The trial-row SHA-256 before presentation edits and after publication/revocation
was `a1bc9985f63fe768897ab850bfed67224b2a3cf2aaaabd4936e62940acd93ddd`.
The hash uses Python `json.dumps(rows, sort_keys=True)` with its default
separators, encoded as UTF-8. The continuing agent checked it against the saved
baseline. Presentation edits did not change these trial rows.

## Cleanup and remaining acceptance

The temporary daemon was stopped before the handoff. The continuing agent
disconnected only the task-created worker through Runner setup, then reloaded
the page and confirmed that the two pre-existing workers remained and **Add
computer** was available. The useful Oracle report remains private. The
synthetic report also remains private with both test links revoked; the product
has no report deletion control. No deletion endpoint was added for cleanup.

Still needed before claiming full acceptance:

- Fresh-account signup and onboarding with a separate real identity.
- Separate signed-in editor and viewer sessions, membership removal and export.
- A model-backed evaluation with separately authorized provider credentials and budget.
- Review and any authorized public-source/documentation transfer. Private PRs,
  hosted observations and local checks do not establish a public release.

Public issues #16 and #17 remain open. Sanitized browser images are retained
with the original acceptance review; they are not part of this source record.
