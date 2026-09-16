# Recent features retrospective

Reviewed 2026-09-16 against the consolidated Vercel, CLI, and hosted-workbench
branches. This is an implementation and workflow review, not a production
usage study. We have automated test evidence but no measured onboarding,
retention, or sharing conversion data.

## Overall assessment

Heval is substantially easier to install, explore, and operate. The most
complete new journey is installing the CLI and inspecting existing results.
The hosted workbench supplies useful execution and persistence primitives,
but the shared online workspace is still missing. Our next release should
connect import, durable results, and sharing before broadening execution.

## Feature outcomes

| Feature | Improvement | Current limit | Decision |
| --- | --- | --- | --- |
| npm CLI | A user can open useful data without cloning the repo or installing evaluation tools | `doctor` and `open` only; local session links; no execution or hosted sync | Keep the narrow working path; add hosted integration after the report service exists |
| Homepage and comparison | Measured results are distinct from the scripted replay; a direct Studio entry makes the product discoverable | The featured comparison is a build-time example, not a user's workspace | Keep the evidence-led entry; add recent/imported evaluations when storage exists |
| Workbench | Configuration, progress, history, cancellation, and opening results in Studio are connected | One legacy async-cache task; browser provider connections support Merge Gateway and Pi, not arbitrary Harbor benchmarks | Reuse the interaction pattern and result handoff; keep the legacy runner's scope explicit |
| Persistent history | Results survive restart, ownership is enforced, and interrupted runs are marked honestly | Files and SQLite on a persistent server; one scheduler process; interrupted execution does not resume | Preserve the semantics when moving hosted reports to managed storage |
| Provider connections | Per-user encrypted credentials and temporary model-restricted worker tokens replace shared operator credentials | One browser provider path; access validation checks the catalog, not an actual successful model evaluation | Keep account ownership and temporary credentials; extend only with end-to-end validation |
| Studio and exports | Charts, filters, trial details, saved bundles, and frozen presentations are reusable across deployment modes | Analysis/Presentation remains a conceptual split; saved presentations can differ from current analysis | Make Create export from this view the next UI simplification |
| Deployment integration | Vercel, Bun, and npm builds have explicit capabilities and tested entry points | A tested build does not provision a database, cloud worker, or production deployment | Keep deployment-specific smoke tests and publish release status explicitly |

## What worked

Shipping a small CLI made an existing capability accessible with one command.
Its example provides immediate value without credentials or paid evaluations.
The tests exercise installation outside the repository, chart exports, bundle
round-trips, and raw Harbor imports; they verify the distributed artifact, not
just source modules.

The workbench correctly treats saved attempts as owned records. Its recovery,
cancellation, daily limits, provider replacement, and credential redaction
have regression tests. Unknown cost remains unknown instead of appearing as
a free evaluation. These are useful foundations for a hosted product.

The existing chart and normalized-result modules allowed us to retain the
CLI viewer while bringing in authenticated server results. We did not need a
second chart implementation for the integrated workbench.

## What did not work well

**Features accumulated on separate branches without a shared release baseline.**
The hosting branch renamed the dataset the CLI builds from. Another branch
added a workbench, signup API, and different homepage assumptions. A local
checkout therefore gave an incomplete picture of what had been implemented.
Our initial assessment missed that work because it inspected only one branch.
Inventory branches, worktrees, and the deployed revision before planning a
cross-cutting feature; integrate completed slices back into main promptly.

**Local completion was mistaken for product completion.** A working localhost
viewer does not create a durable URL another person can open. A bundle is
portable, but sharing it still requires file handling. Uploaded report storage,
access rules, and revocable URLs remain the highest-value missing connection.

**Build success did not establish deployment compatibility.** Combining the
Bun workbench with the static Vercel frontend would expose controls backed by
missing APIs. Integration now gives Vercel a dedicated showcase build and
tests it against a server with no API. The public Bun build separately checks
that private/test fixtures are excluded from its web assets.

**The original analysis-to-presentation problem remains.** The local/static
viewer now opens a browser-rendered poster, but the full app still defaults
to Social images. Existing presentations remain frozen. That behavior protects
old exports, but users need an explicit Create export action and a visible
source/update relationship instead of inferring it from a mode switch.

## Remaining work, in priority order

1. **Hosted import, results, and sharing.** One persistent report identity,
   owner-only access by default, explicit share creation, revocation, and a
   report page that works in a fresh browser without the uploader's machine.
   Convex packages are present; no Convex service has been configured.
2. **Define the upload contract before accepting arbitrary files.** The current
   publication helper stages reviewed exports for the next build. Its row
   parser retains arbitrary scalar fields; it is not a credential-removal
   boundary for untrusted uploads. A hosted importer needs size limits,
   validation, an explicit field policy, and a preview of what will be shared.
   See [publish-result.ts](../scripts/publish-result.ts) and
   [motion-input.ts](../src/project/motion-input.ts).
3. **Make export follow the current analysis.** Preserve metric, filters,
   source selection, and grouping. Keep existing exports frozen and provide
   an explicit update action. See [Studio.tsx](../src/studio/Studio.tsx).
4. **Improve execution provenance before broad benchmark comparisons.** The
   legacy run export currently has unknown harness version, vendor, and token
   breakdown. Its agent duration is measured from run acceptance, so it can
   include setup time. Do not equate that with Harbor's agent-step timing.
   See [run-export.ts](../server/run-export.ts).
5. **Add one supported Harbor cloud path after the shared workspace exists.**
   Reuse the report identity and status model. Establish benchmark-version and
   environment compatibility, billing ownership, and measured-run evidence
   before describing the workbench as general benchmark execution.

## Evidence and practical limits

Local consolidation checks passed: typecheck and lint; 22 project/chart tests;
34 server tests; 6 CLI unit tests; 67 desktop/mobile browser tests with one
expected skip; packed CLI install/browser tests; and a real Docker isolation
and grading check. The six workbench browser checks also passed after fixing
the terminal resize loop.

Production-build smoke checks exercised the Vercel routes, example charts,
browser export, mobile layout, the public catalog, private-run authentication,
and a JSON import. The web container built and ran as a non-root user. No paid
model calls were made, and these checks do not prove a live cloud benchmark,
production WorkOS login, or managed database deployment.

The integration also fixed an unnamed mobile import control and an empty
catalog that appeared to load forever. These were visible only when testing
the new deployment combination, which is why the build-specific walkthroughs
now run in CI.

## Process for the next slice

Use consolidated main as the starting point and keep feature branches short.
State which parts of each feature are implemented, tested, and deployed.
Keep one acceptance journey for the next release:

**Sign in → import → reopen saved report → share → open anonymously → revoke.**

Observe a few first-time users completing that journey. Measure where they
stop and whether they understand what is shared before expanding the feature
set. Engineering tests establish correctness; they do not establish usability.
