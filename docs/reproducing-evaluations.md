# Reproducing an evaluation

Record the dataset revision, task checksums, model IDs, serving vendors, harness
versions, attempt count, and timeout settings for each evaluation. Keep raw
Harbor job directories privately; publish only reviewed normalized results.

The `results/harbor/demo-evaluation.json` file contains synthetic data for the UI
and tests. It is not a benchmark run and its model IDs are not callable endpoints.
`experiments/demo-comparison.json` demonstrates the profile format using that
same synthetic fixture; it intentionally has no runnable Harbor template.

```sh
bun run experiment baseline
bun run experiment verify results/harbor/demo-evaluation.json
bun run report /path/to/your/harbor-job
```

For actual evaluation setup, follow [Connected runners](connected-runners.md).
For combining completed runs and preserving their provenance, see
[Exporting Harbor results](../harbor/report/README.md).
