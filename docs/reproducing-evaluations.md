# Reproducing the Merge comparison

The saved comparison profile is experiments/merge-comparison.json. It declares the six exact model slugs, serving vendors, Codex version observed in the results, 20 task names/checksums, a hash of the archived result file, and both chart collections. Change a copied profile to create another experiment; do not silently repurpose the archived baseline.

## Three different guarantees

1. Identical image files: use the committed thread ZIPs under results/harbor/threads/merge-evaluations and merge-evaluations-all. These retain the exact delivered bytes.
2. Same charts and numeric values: render the archived normalized JSON with its saved chart configuration and the same software revision. A different OS, browser or font rasterizer may produce different PNG bytes even when the chart is visually equivalent. ZIP timestamps and generated manifest timestamps also change.
3. Fresh evaluation with the same comparison configuration: the profile fixes model IDs, serving vendors and task selection and verifies the recorded harness version/checksums afterward. It does not guarantee identical pass/fail outcomes, costs, or times. Hosted model aliases can change internally; seeds do not guarantee deterministic execution across providers. Network load, scheduling, caching and prices can change too.

The existing evaluation template selects 30 tasks. The delivered result contains 20 per model. Use the profile-generated run config when reproducing this comparison rather than invoking the old 30-task template unchanged.

## Recreate the saved charts without running models

From the repository root:

~~~sh
bun install --frozen-lockfile
bunx playwright install chromium
bun run experiment baseline
bun run thread:merge:all
~~~

The baseline command checks the recorded file hash and cohort before rendering the four-image thread into results/harbor/threads/recreated. The second export command generates all six chart presets. Both use existing results, not fresh model calls. Local Node and Bun are required; fonts and logo are vendored.

## Prepare a new evaluation without starting it

~~~sh
bun run experiment prepare .scratch/my-rerun.yaml
~~~

This creates a fresh job name, a Harbor-compatible YAML file (JSON syntax is valid YAML), and a matching .pins.json file for the existing vendor proxy. It selects the exact six full model IDs and the exact 20 task names. Existing output configs are not overwritten. Review concurrency against available Docker resources.

Follow the existing Harbor setup workflow, start the vendor proxy with the generated pins file, and pass the generated config to Harbor. No evaluation is automatically started by prepare. Credentials remain in environment files.

The historical baseline observed Codex 0.152.1. The existing harness template does not pin the installer to that version. Provision it through the installed Harbor adapter's supported version controls before running, or explicitly create a new experiment when upgrading. Task checksums are verified after normalization; Docker image digests, resolved provider weight revisions and the original complete pricing snapshot were not recorded, so this profile cannot recover those missing historical pins.

## Verify and render new results

After normalizing the new Harbor job with bun run report:

~~~sh
bun run experiment verify results/harbor/my-new-run.json
bun run experiment charts results/harbor/my-new-run.json experiments/merge-comparison.json results/harbor/threads/my-new-run
bun run experiment charts-all results/harbor/my-new-run.json experiments/merge-comparison.json results/harbor/threads/my-new-run-all
~~~

Verification rejects missing/extra models, vendor changes, harness/version changes, task checksum changes and missing/repeated attempts. It deliberately does not require the new outcomes to equal the old scores. Missing metric values remain governed by the chart presets' coverage rules. Preserve each run separately and compare it to the baseline rather than overwriting baseline.json.

## Extending the comparison

- Models, vendors, task selection and attempts: copy/edit the experiment profile. A model not present in the Harbor template also needs an agent entry there. The current image templates support up to six models and one attempt per task; repeated-attempt policies require an explicitly named aggregation design.
- Export selection and source/visibility: edit the referenced chart settings JSON or use Studio's Social images tab, then save the project/bundle.
- New metrics: add a definition/calculation in src/charts/social-presets.ts. Existing layouts and Studio/export routes consume that registry.
- New layouts: add rendering in src/charts/social-render.ts. Preview and export share it.
- Future stronger run provenance: record resolved model revisions when exposed, agent install versions, container image digests, task package hashes, generation options, tool versions, timeout/retry policy, vendor routing, and the price table used. Retain raw outputs and normalized results for each run.
