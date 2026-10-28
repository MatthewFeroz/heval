# Public task and run gallery

Status: proposed product direction. Consolidating development work does not
implement this gallery or publish existing private results.

OpenEval should let visitors choose a task, inspect what different harness/model
stacks produced, and compare those outputs visually without signing in. The
reference is [WhichAI](https://github.com/SunkenInTime/which-ai): real generated
outputs, preserved attempts and shareable comparisons with visible conditions.

## First useful version

Start with one reviewed frontend task, a fixed model and two harnesses. Preserve
every attempt. Capture the rendered result and executable-verifier outcome for
each trial, then publish an approved collection with a two-run comparison page.
Keep the task prompt, task/environment version, harness and model versions,
configuration, attempt number, measured duration and cost provenance accessible.
Missing metrics remain unknown.

The public pages should support:

- A task page with its prompt, constraints, verifier and published runs.
- A gallery of actual output previews labeled by harness, model and configuration.
- A shareable comparison of two trials on the same task, showing what was held
  constant and what changed. Different task snapshots must be disclosed.
- Trial details with approved output artifacts, verification results and evidence.

Screenshots and isolated previews suit frontend tasks. Code patches, test output
and terminal evidence serve other coding tasks. Visual/editorial judgment stays
separate from task-verifier success. Selecting an attractive attempt must not
hide failed or missing attempts from the collection.

## Reuse the existing evaluation path

Continue executing through the connected Linux worker, supervisor and Harbor.
Use existing experiments and normalized trial identities to associate outputs
with their exact trials. Reports and Studio continue to present results;
presentation edits never rerun tasks or change outcomes.

The missing boundary is an explicit output-artifact publication path. Hosted
report imports currently allow metrics and provenance, not arbitrary generated
files or raw logs. Add approved artifact capture, storage and publication rather
than expanding that metric importer to copy worker directories. Keep provider
credentials and raw execution artifacts on the worker. Generated applications
need isolated preview origins; they must not execute inside the authenticated
workspace origin.

Publish curated collections through an explicit owner action. Keep private runs
private, preserve the existing report-sharing behavior, and define collection
revocation before connecting the gallery to hosted data. Begin with approved
static previews; interactive hosting can follow once its isolation is verified.
