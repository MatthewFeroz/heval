# Migrating connected run summaries

New connected run completions store a result summary on the run alongside its
saved report. Experiment status reads use this summary for trial/pass counts,
the median successful agent time, harness versions, token totals and reported
cost. Unknown token or cost values remain unknown. Cancellation with recorded
partial results uses the same summary calculation.

The cached version preview retains the first sixteen distinct harness versions
in their original encounter order. `additionalVersions` gives the exact number
of other distinct versions, or zero when the preview is complete. Experiment
details disclose that count and link to the run report. Every observed version
remains in the original report's trial data. This keeps run records small enough
for status lists, capacity checks and combined-report scans even when every
trial reports a different version. Scalar metrics still cover all recorded rows.

Existing runs remain readable through a compatibility fallback that computes
their metrics from the original report. This fallback still reads the full
report on experiment status updates. Large historical experiments can therefore
still exceed Convex's transaction read limit until their summaries are backfilled.
Deploying the schema and code alone does not complete this migration.

After an authorized deployment, an operator can invoke the internal mutation
`runners:backfillResultSummaries` with `{"cursor":null}`. It scans ten runs per
transaction and reads at most ten source reports. Pass the returned `cursor` to
the next invocation until `done` is true.

Valid normalized reports can exceed their original 750 KB upload after optional
fields become explicit nulls. Stored report validation preserves those records
and still validates every field. Ten source documents remain below 10 MiB using
Convex's 1 MiB document limit, leaving room under its 16 MiB read limit.
Cached runs and runs without reports are skipped. Repeating a page is safe.

The response contains `scanned`, `updated`, and an `unavailable` list of run IDs
with missing or invalid source reports. No report data, execution outcomes or
existing summary is changed. `done` means the scan reached its end; it does not
mean unavailable records were repaired. Retain the unavailable IDs for inspection
and start another pass from a null cursor after correcting their source records.
They retain the compatibility fallback until a valid summary can be created.

This migration is an operator action. Local backend tests verify the page limits,
resume behavior and summary equality. They do not deploy this code or migrate a
hosted workspace.
