# Live evaluation monitoring

Connected evaluations show per-harness task counts and an expandable task activity
log on the evaluation page. Updates arrive about every five seconds while the
worker and website are connected. Results are provisional until the saved report
is available; execution errors are counted separately from failed verification.

The activity log records task starts, passes, failed verification, and execution
errors observed in Harbor artifacts. It does not stream terminal output, model
messages, tool arguments, file contents, or reasoning. Those remain local.
Elapsed time includes task setup and verification; it is not agent-only latency.
Tokens and costs remain in the final report when the harness provides them.

Closing the browser does not stop monitoring or execution. The detached worker
supervisor stores the latest task snapshot and latest 200 lifecycle events locally.
After a connection loss the daemon sends that snapshot, including completed tasks;
intermediate snapshots are coalesced rather than replayed one by one. The website
retains the latest received snapshot after completion. This is a bounded activity
window, not a complete audit log. Up to 1,000 observed trials are supported.

“Worker offline” means its heartbeat stopped. “Monitoring delayed” means the worker
is connected but telemetry is stale. Neither means the harness has stopped. Task
timers freeze at the last sample when offline, delayed, or finished. A cancelled
task with no result stays unfinished rather than being counted as a failure.

## Maintainer notes

Deploy the additive Convex schema/functions and web UI, then update idle workers.
Older workers show a monitoring-unavailable message; their execution and report
uploads continue to work. No existing evaluation is restarted or migrated.
Telemetry upload failures never block cancellation or final report delivery.

The collector reads only regular, bounded Harbor result files and emits allowlisted
fields. It never copies log text or credential-bearing configs. The backend checks
machine credentials, session, run claim, owner access, payload bounds, and snapshot
sequence before storing data. Summary subscriptions omit trials and events until
the viewer opens the activity details. See
[`monitoring.ts`](../packages/cli/src/runner/monitoring.ts) and
[`runners.ts`](../convex/runners.ts) for the implementation.
