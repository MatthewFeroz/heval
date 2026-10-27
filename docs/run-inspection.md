# Inspecting recorded runs

Results includes a task browser above the saved chart. Search by task name or
show tasks with different outcomes, failures or timeouts. All report trials are
available here independently of saved chart filters. Repeated attempts remain
separate choices. Choose two attempts to inspect output, patches, verifier
output or recorded events side by side.

The comparison checks task content digests and benchmark/dataset versions.
Missing pins and mismatches are shown explicitly. Matching task content does
not imply matching harness settings, model or serving vendor. Each panel shows
the recorded configuration and metrics; missing cost and timing stay unknown.
Comparison URLs preserve the task, attempts and evidence view. They do not
grant access. A private URL still requires report access, and a shared URL
retains its existing share token and publication rules.

## Recorded timelines

Updated connected workers already send bounded Harbor lifecycle monitoring.
On report completion, the backend saves available observed starts and outcomes
as private timeline evidence. It copies available evidence into the combined
experiment report using the combined trial identifiers. Up to 200 evidence
items and 750 KB of evidence are retained per report. Older reports and trials
outside the retained monitoring window can have no timeline. OpenEval does not
reconstruct missing commands, reasoning or edits from metrics.

Richer timelines can be attached through **Attach private trial evidence** or
the reviewed worker manifest below. This is a portable event format, not an
automatic parser for harness transcripts:

```json
{
  "schemaVersion": 1,
  "events": [
    { "at": 1000, "kind": "command", "title": "Run tests", "text": "bun test" },
    { "at": 2000, "kind": "test", "title": "Tests completed", "text": "Observed verifier output" }
  ]
}
```

This example demonstrates the format only. `at` is a recorded millisecond
timestamp. Events must be ordered. Supported kinds are `started`, `passed`,
`failed`, `error`, `command`, `edit`, `test` and `message`. Each timeline allows
1–100 events, titles up to 160 characters, optional text up to 4,000 characters
per event and 16 KB for the entire JSON. The viewer supports stepping through
events, selecting a position and inspecting the retained list.

## Visual output

Attach an HTML file or PNG screenshot to its actual trial. HTML and embedded
PNG evidence allow up to 100 KB each, including the PNG's base64 encoding.
Patches and verifier text allow 16 KB each. Multiple artifacts are selected
within a panel rather than stacked down the page.

HTML is a static recorded preview. The viewer removes scripts, navigation,
forms, embeds, remote resources and SVG animation before loading it into an
opaque sandboxed frame. A restrictive content security policy blocks scripts
and network access. Fit-panel and mobile-width views are available. Screenshot
expansion changes the view without changing the saved image. Running a
generated application with JavaScript requires a separate execution sandbox;
this first visual stage does not execute generated applications.

## Reviewed worker artifacts

The connected runner still requires Linux, Harbor 0.24.0, Docker Engine and
Docker Compose as described in [connected runners](connected-runners.md).
Automatic monitoring does not upload prompts, terminal transcripts or arbitrary
files. To opt into explicit artifact uploads, start the updated daemon with:

```sh
HEVAL_CAPTURE_REVIEWED_EVIDENCE=1 heval runner start --state <state-directory>
```

After reviewing an artifact, create
`<state-directory>/runs/<run-id>/reviewed-evidence.json`:

```json
{
  "schemaVersion": 1,
  "entries": [
    {
      "trial": "actual-trial-id-from-this-run",
      "title": "Reviewed output",
      "kind": "html",
      "text": "<h1>Recorded output</h1>"
    }
  ]
}
```

This example demonstrates the format only. The manifest must be a regular
file, not a symlink, and contain 1–12 entries within 200 KB. Each entry has a
trial, title, kind and text. Kinds are `patch`, `verifier`, `timeline`, `html`
and `image`. PNG image text uses `data:image/png;base64,...`. No file paths or
remote URLs are fetched from this manifest. The server verifies that each
trial belongs to the completed run and that the worker owns its claim.

Uploads run after report delivery, retry on later polls and persist a content
receipt. Repeated uploads do not duplicate evidence. Failure to upload artifacts
does not block execution or report delivery. Combined reports receive the same
private evidence where capacity permits. Uploading is separate from publication:
the report owner must review and publish each evidence item before it appears
on a shared report. Revoking the report link stops subsequent public reads.

## Verification

`bun run test:runs:ui` checks task selection, attempts, evidence views, timeline
controls, comparison links, browser history and output isolation using labeled
synthetic fixtures. Backend tests check ownership, claim scope, replay safety
and publication. The connected evaluation test exercises actual Linux worker,
Harbor, Docker and report delivery without model calls.
