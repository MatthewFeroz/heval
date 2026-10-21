# Finish Sprint 1 acceptance

Sprint 1 issue #10 is complete. The remaining criteria are in public issues
[#9](https://github.com/MatthewFeroz/heval/issues/9),
[#11](https://github.com/MatthewFeroz/heval/issues/11) and
[#12](https://github.com/MatthewFeroz/heval/issues/12).
Sprint 2 issues #16, #17 and #18 track their unfinished work, not replacement
features. Preserve delivered status reports; report later completion separately.

## Establish the acceptance environment

Record the intended frontend origin and deployed source/backend revision,
Clerk instance and JWT issuer, installed CLI artifact/runtime versions and
Oracle profile/task digests. Keep private identity, address and credential details
in an ignored evidence directory. Check that the Linux worker is idle and healthy.
Use isolated runner state and synthetic reports; do not replace another worker's
pairing. A green source CI result does not verify real Clerk sign-in or deployment.

## First-run walkthrough: #9

Use a fresh real Clerk account on the intended hosted app. Follow
[first evaluation steps 6-9](first-evaluation.md#6-create-a-pairing-code-in-the-browser)
to pair the isolated worker and run the standalone Oracle check without a model
key. Record the original run ID and verify one saved trial and one pass.

- Open the report from setup, then revisit it from Evaluations and Report library.
  Refresh and confirm the same saved evaluation and correct account ownership.
- Reach the primary setup/run/report actions using the keyboard. Check the setup
  and report controls at a narrow viewport. Record any blocker with its next action.
- Check missing-profile, unhealthy, offline, loading and incompatible-selection
  guidance using appropriate isolated/simulated states; label that evidence.
- Compare the public wiki Prototypes page and first-evaluation guide to the
  observed flow. Update stale references/captures with a tested source revision.

The participant completes real sign-in/verification prompts. No provider key or
paid model run is required. Do not claim real model-backed execution from the
Oracle check or from the compatible-selection browser fixture.

## Report access walkthrough: #11

Import the clearly labeled synthetic
[`report-sharing.json`](../tests/fixtures/report-sharing.json) as the owner.
Use separate owner, editor, viewer and anonymous browser contexts with actual
Clerk sessions for the signed-in roles. Record expected and observed behavior:

1. Before publication, anonymous users and nonmembers cannot read the draft or
   download its private exports. Knowing an ID does not grant access.
2. Invite an editor and viewer. The editor can save a Studio draft; the viewer
   cannot. Neither can manage members, publish or revoke links. Membership gives
   no machine-control access.
3. Compare stored trial rows/provenance before and after presentation saves and
   exports. Only presentation data changes.
4. Publish revision A. Save unpublished draft B. Anonymous reading still shows A.
   The owner explicitly publishes B before public readers can see it.
5. Revoke the link and verify fresh anonymous reads fail. Share again; the new
   token differs and the old link remains unavailable.
6. Remove both member roles. Verify subsequent private reads, writes, export
   submission/history and authenticated downloads are denied, including a
   previously working download. An active public link still grants public access;
   revocation and membership removal are different operations.

Use the existing [hosted export guide](hosted-presentation-exports.md) for export
configuration. A missing renderer/storage deployment is a recorded acceptance
gap, not proof that downloads work. Files already downloaded cannot be recalled.
Run `bun run test:backend` and `bun run test:exports` for the authorization
regressions; label simulated UI and live account evidence distinctly.

## Reproducibility and release documentation: #12

Execute the [isolated Oracle example](reproducible-evaluation.md), retain its
actual approval/provenance and normalized outcome, and check the instructions
from the reviewed public checkout. Complete the
[maintainer checklist](publishing-cli.md#coordinated-release-evidence-and-rollback)
and reconcile current wiki references. Use existing acceptance results where
they still apply; record versions and limits rather than asserting a deployment
or package was upgraded by a source merge.

## Evidence and closure

For each scenario, record date, tested revisions/artifacts, prerequisites,
run/report IDs, steps, expected result, observed result and limitations. Keep
sanitized screenshots or a short recording for the relevant user flow. Redact
account details, tokens, local addresses/paths and real evaluation data.

Attach public-safe evidence to the relevant issue/wiki page only after review.
Close #9/#11/#12 and their corresponding carryover issues when their criteria
actually pass. Mark the project items Done. A new status report can record that
Sprint 1 work was completed after its deadline; do not revise the already
submitted October 13 snapshot.
