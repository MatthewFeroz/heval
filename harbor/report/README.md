# Exporting and combining Harbor results

Export a completed job and render its report:

```sh
bun run report /path/to/jobs/job-name
```

Combine jobs run at different times, or existing normalized exports:

```sh
bun harbor/report/merge-jobs.ts results/harbor/comparison.json \
  /path/to/jobs/first-job /path/to/jobs/later-job existing-export.json
bun run report results/harbor/comparison.json
```

The exporter accepts built-in and custom Harbor agents. It resolves identity from
`agent_info.name`, configured `agent.name`, or `agent.import_path`. A result with
no identity is retained as `unknown`. A separate trial config is optional when
Harbor stored the resolved configuration in the result. Malformed results and
trial configs without results fail the export rather than silently disappearing.

Combined JSON retains original rows, trial IDs, task checksums, source paths,
run IDs, harness versions, and configured `thinking` / `reasoning_effort` kwargs.
Source export metadata, including attached manifests, is retained under `sources`.
No raw credentials, environment dictionaries, or arbitrary agent kwargs are
copied from Harbor configuration. Missing usage and cost remain null. Duplicate
trial UUIDs are rejected, including copies from another path. Legacy exports
without UUIDs use source/run/trial identity for duplicate detection.

This is a normalized report export, not a lossless archive of arbitrary Harbor
files. Keep original job directories for transcripts, logs, and other metrics.
The existing report uses the `reward` metric and treats missing rewards as zero;
it does not infer pass criteria for other verifier metrics.

Combining files does not establish comparability. Pin the dataset revision,
model, reasoning settings, task limits, and harness versions. Record Gateway
revision and endpoint in an attached source manifest when known; the exporter
cannot infer a deployment revision from trial output. Inspect those differences
before presenting the rows as a single comparison. Never put credentials in a
manifest or normalized JSON supplied to the merge command.

Run exporter regression tests with:

```sh
bun test harbor/report/trials.test.ts
```
