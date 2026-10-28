# OpenEval launch readiness

Assessment date: October 26, 2026. Initial audit source: `6bd47be`.
Implementation notes refer to the subsequent unreleased working changes.
This is a source assessment and launch plan, not certification of the deployed
application or evidence of a package publication.

## Launch shape

Launch an open-source evaluation tool alongside a hosted workspace beta. Use
the same runner, normalized results and reproducibility metadata for both.
Start with developers and small teams choosing between coding-agent stacks.

Proposed promise: **Compare coding-agent stacks on the same tasks, inspect what
happened, and share the evidence.**

| Open-source product | Hosted product |
| --- | --- |
| Run evaluations on user-controlled workers | Run guided comparisons on managed cloud workers |
| Inspect local Harbor jobs and normalized exports without an account | Keep private reports and experiment history online |
| Export portable results and reports | Collaborate, publish and revoke report links |
| Document a reproducible standalone workflow | Offer operated storage, support and clear service limits |

The selected hosted direction uses managed execution by default for invited beta
accounts, with connected customer workers as an alternative. The implementation
uses a Railway coordinator and disposable Daytona Linux VMs. Source support
includes baseline save/repeat and private trial evidence with separate reviewed
publication. Provider configuration and actual cloud acceptance remain required;
see [managed comparison setup](../managed-comparisons.md).

## Release blockers and pass conditions

| Priority | Evidence in source | Required outcome |
| --- | --- | --- |
| 1 | Apache-2.0 source license and notices added after the 0.3.1 release | Verify LICENSE and NOTICE in the next CLI artifact; already published 0.3.1 retains its original metadata. Confirm rights for included assets and dependencies. |
| 2 | Onboarding copies `npx @mattferoz/heval@latest setup`; setup docs say registry version 0.2.0 lacks that command | Publish a separately authorized, tested setup-enabled artifact, or make the primary onboarding path work with the actual stable release. A fresh user must be able to paste the displayed command successfully. |
| 3 | Homepage copy now describes comparisons; the catalog retains explicit unsupported adapter states | Validate the supported launch combinations. Retain the documented Deep Agents accounting limitations. |
| 4 | Available connection check is not a capability benchmark; both TBLite entries remain preview | Validate one useful task set and two supported harnesses end to end through the hosted flow. Record task pins, versions, all attempts and metric provenance. Keep larger unvalidated datasets labeled preview. |
| 5 | October 20 hosted evidence leaves fresh accounts, teammate roles and paid model execution untested | Complete the remaining acceptance checks on the intended release deployment. Preserve dated evidence and exact frontend, backend, CLI and Harbor versions. |
| 6 | Hosted report guide explicitly lists deletion as future work | Provide a tested report deletion path and define account closure, retention and export behavior before broad hosted availability. Explain which raw artifacts remain on users' workers. |

See [setup status](../setup-command.md), [harness catalog](../../src/harness-catalog.json),
[benchmark catalog](../../src/runners/benchmarks.ts),
[hosted acceptance](../sprint-1-acceptance.md), and
[release checklist](../publishing-cli.md#coordinated-release-evidence-and-rollback).

## Improvements that make the product more useful

1. Connect the public comparison to a guided "Run a comparison" path. Preserve
   task pins and supported settings. Ask explicitly before starting paid work.
   Keep anonymous exploration available before installation or sign-in.
2. Offer one recommended starter comparison with a validated task set, two
   supported harnesses and a fixed model. Let users distinguish a harness
   comparison from a model comparison. The connection check stays a setup check.
3. Make the result explain outcomes. Show passes, verifier failures, execution
   errors and timeouts separately, with the measured population and uncertainty.
   Keep unknown costs visible and separate estimates from reported charges.
4. Add approved task outputs to one public comparison. Begin with static output
   images, patches or verifier evidence linked to their exact trials. Review
   artifacts before publication and preserve failed attempts. Follow the
   [gallery proposal](public-run-gallery.md); hosted output publication is not
   implemented by the current metrics database.
5. Support returning users with a repeat-comparison workflow that records which
   versions and settings changed. Preserve previous results rather than editing
   outcomes. Baseline regression tracking can follow evidence of repeat use.

## Hosted beta acceptance

- A fresh account can install the released package, connect a worker, pass the
  no-model check, complete an explicitly authorized model comparison, reload its
  saved result and share it with an anonymous reader.
- Separate real owner, editor and viewer accounts exercise invitations, draft
  editing, publication, member removal and export downloads. Check revoked links
  and previously working download URLs. Backend fixtures alone do not pass this.
- Disconnect/reconnect, cancel and deadline paths preserve completed evidence
  and do not duplicate paid execution. Unsupported selections explain recovery.
- Actual exports work with the intended renderer and storage configuration.
  Exercise keyboard access and narrow-screen setup, results and sharing.
- Verify a backup restoration and compatible rollback on isolated state. Record
  support contact, service limits and who responds to failed runs or exports.
- Measure hosted database, storage and export-rendering costs before choosing
  free quotas or paid limits. User-supplied compute does not remove hosting costs.
- Instrument setup start, pairing, free-check completion, first model report,
  sharing and return use without collecting provider keys or raw task contents.

Before charging, also define paid entitlements, enforce limits on the backend,
and test purchase, payment failure, cancellation and access after downgrade.
These are requirements for a paid service, not prerequisites for a free beta.

If managed workers are included at launch, add provisioning, tenant isolation,
credential handling, enforceable compute/model budgets, queue limits, cleanup,
abuse controls and measured per-run costs to the release gates. The existing
connected worker and legacy Docker adapter do not establish these properties
for a managed multi-tenant service.

## Suggested order

1. Reconcile license, supported claims and the released onboarding command.
2. Complete one meaningful comparison and the remaining hosted acceptance.
3. Observe five target users through setup and report sharing. Proposed launch
   target: at least four finish without maintainer intervention. Record cold
   installation time separately from configuration and evaluation time.
4. Prepare a short walkthrough, one approved real comparison, quickstart,
   troubleshooting guide, contribution instructions and security contact. Review
   selected changes and artifacts in the separate public checkout.
5. Release open source and a limited hosted beta. Use repeat comparisons and
   collaboration demand to choose the first paid offering.

## Verification performed for this assessment

At the initial audit revision, lint and production build passed. Unit tests passed
59/59, backend tests 93/93, hosted-export tests 7/7, and browser tests 37/37.
Browser tests cover local screens and fixtures, not real hosted accounts.
The CLI suite passed 59/60: its process-identity assertion requires Linux
`/proc` and fails on a non-Linux host. This does not establish a Linux worker
failure; require the supported Linux checks before release.

The implementation separates the portable file-permission assertion from the
Linux-only process-identity test. The latter still runs on Linux. Source checks
also cover managed queue authorization, leases, recovery, immutable baselines
and separately reviewed evidence. A native Linux worker image has completed the
bundled Oracle task to 1/1; an AMD64 image build is separate from actual AMD64
provider acceptance. The packed CLI's local installed-artifact checks passed.

Current hosted resources, real sign-in, model billing, the registry artifact and
connected Linux execution were not verified in this assessment. October 20
records are historical evidence with their stated limits.
