# Guided evaluation workflow

Proposed product design, 2026-09-16. This document describes future behavior;
the published 0.1.0 CLI only checks setup and opens results. It does not run
evaluations. Builds on [the UI review](ui-and-local-runner-review.md).

## Product entry and navigation

Make one evaluation workspace connect selection, execution, evidence, and
exports. Primary navigation: Evaluations, Benchmarks, Learn, Settings.

Home actions: **New evaluation**, **Explore example**, **Import results**.
Returning users see recent evaluations and their state above the tutorial.
Examples always carry an Example label. Viewing local results requires no
Heval account.

Proposed command: `npx @mattferoz/heval start` opens the local application.
Keep `open <path>` for existing results. The public website explains the flow,
offers examples, and provides this launch command; execution happens through
the installed local service. Show “Running through your local Heval service”
and the selected local or cloud environment before launch.

## First evaluation, screen by screen

| Screen | User decision | Visible explanation and action |
| --- | --- | --- |
| Choose benchmark | Search for Terminal-Bench; select version 4.0 | Purpose, source, version, task count from metadata, resource requirements, tested compatibility; Continue |
| Choose agent and model | Pick an agent, then a compatible model | “The agent uses tools; the model decides what to do.” Show credential requirements for this combination only |
| Choose scope | One-task setup check, small exploration, full benchmark | Default first run to one curated compatible task and one attempt; show exact tasks and total attempts |
| Choose environment and check setup | This computer or a supported cloud provider | Check selected tasks' requirements, Harbor compatibility, resources, agent/model route, and credentials; preserve choices while fixing problems |
| Review | Verify what will execute | Benchmark version, agent/model versions, task IDs, repeats, concurrency, environment, output location, cost uncertainty; Start evaluation |
| Watch run | Follow progress; inspect logs or stop | Preparing, queued, running, grading, passed, failed, errored, cancelled; completed/total and available cost coverage |
| Understand results | Inspect failures, compare, or run again | Summary first, then tasks and traces; infrastructure errors separate from task failures |
| Create export | Choose image or saved workspace | Starts from current metric, filters, grouping, and data; preview, then download |

One task × one agent/model configuration × one attempt = one trial. Two
configurations × ten tasks × three attempts = sixty trials. Explain the
arithmetic beside the scope control. Concurrency changes simultaneous work,
not total trial count.

Preserve a draft between screens and after a setup failure. Allow experienced
users to edit the generated config, with validation, under Advanced. Do not
require chart settings, proxies, registry identifiers, or config files in the
default journey.

## Terminal-Bench 4.0 specifics

The [official benchmark list](https://www.tbench.ai/benchmarks) lists version
4.0. Its [Harbor dataset page](https://hub.harborframework.com/datasets/terminal-bench/terminal-bench/4)
notes GPU and multi-container tasks and recommends Modal or Daytona.

Fetch and resolve the selected version to immutable dataset/task references.
Do not silently run latest when the user selects 4.0. Confirm registry syntax
and resolution against the Harbor version we actually support.

Heval currently recognizes Harbor 0.22.0. Compatibility with this dataset and
the current registry has not been established. A catalog entry can link to the
upstream dataset while clearly saying “Execution support not yet verified.”
It must not look runnable until its adapter and environment have been tested.

For the first-run exercise, curate a task verified to run on the selected
environment. If that cannot be done for 4.0 on the user's machine, offer cloud
execution or an explicitly named different tutorial dataset. Never silently
change versions, omit incompatible tasks from a full run, or describe a subset
as a full benchmark score.

## Tutorial and recovery

Provide two paths that use the actual interface:

1. Explore without setup: open example, inspect a failed task, change a metric,
   export that view. No credentials or execution charges.
2. Run your first task: select the benchmark and compatible tutorial task,
   connect one provider, fix setup checks, review, execute, inspect grading.
   Explain that this verifies setup rather than establishing model quality.

Advance steps when the user completes the action. Make the guide dismissible
and resumable. Finish with “Add a second model” and “Expand task set.” Copy the
same task selection for comparisons; flag differences in versions, tasks,
attempts, environments, or coverage.

Every failure names the problem and gives a specific next action. Distinguish
credential presence from verified access. A selected cloud environment should
not be blocked by an irrelevant local Docker check. Do not give precise time
or cost promises without evidence; show unknown values and coverage honestly.
If implementing a spend threshold, describe any in-flight overshoot instead
of presenting it as a guaranteed provider billing cap.

Closing the browser must not cancel a run. A supervised local runner owns its
lifecycle; reopening reconnects to durable status and logs. Runner termination
must be reconciled as interrupted after restart. Stop explicitly cancels
execution and cleans up resources. Retry creates linked attempts, retains
prior evidence, and never silently replaces the original score.

## Connect results to exports

Replace the primary Analysis/Presentation mode switch with **Create export**.
Keep saved exports accessible inside the evaluation. The export preview uses
the currently selected analysis; choosing another social template is explicit.
An export records its source run, view, and frozen data snapshot. Later changes
show “Results changed since this export” with an explicit update action.

Results answer “What happened?” before exposing chart design. Show completion,
execution errors, duration, and cost coverage, then task evidence. Put encoding
and spec controls under Customize chart. Collapse controls on small screens.
Use “Save workspace with data” instead of requiring users to understand Bundle.

## Implementation sequence

1. Benchmark catalog and saved evaluation draft; accurate compatibility labels
   and a review screen with a reproducible config. No paid execution yet.
2. One supported agent/provider/environment path; selected-plan preflight,
   supervised Harbor process, persistent state, progress, cancellation, and
   automatic results ingestion. Test one real task with explicit run consent.
3. Results-first workspace, create-export action, and the integrated first-task
   tutorial. Existing imported jobs use the same results experience.
4. Additional supported providers, comparisons, repeats, retry/resume where
   supported, and reproducible larger benchmark runs.

Keep Harbor responsible for task execution and grading. Heval owns discovery,
configuration, orchestration, interpretation, and exports. UI and CLI consume
one validated run plan. Store benchmark/task references, runner and agent
versions, model/provider, task selection, attempts, environment, and raw output
references; exclude credentials from shareable plans and artifacts.

The current viewer is read-only. Add execution as an explicit local capability
with authenticated requests, exact origin checks, validated arguments, and no
arbitrary shell endpoint. Preserve the lightweight results-only path.

## Acceptance criteria

- A new user can identify the benchmark, agent, model, scope, and environment
  before execution, without reading repository documentation.
- One supported first-task journey works from the installed package through
  grading and export; its controls exercise the real runner.
- Missing setup explains one actionable fix and does not erase the draft.
- Reopening the UI during execution restores progress; interruption is visible.
- Results distinguish failed tasks, execution errors, and incomplete coverage.
- Exports match the selected view and retain their source and snapshot.
- A saved plan reproduces the resolved selection; subsets are visibly labeled.

Measure setup completion, time to first completed task, abandonment by step,
successful recovery, and first export. Gather these through opt-in telemetry
or observed usability sessions; do not ship automatic usage collection as part
of this design change.
