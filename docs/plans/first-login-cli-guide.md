# First-login CLI guide

Show a four-step, skippable guide the first time a signed-in account opens a
workspace page. Preserve the requested page and its query/fragment. Anonymous
shared reports and the local CLI viewer never show onboarding.

1. **Try the example:** Node 22+, `npx @mattferoz/heval@0.1.0 open`, a local
   browser viewer, no model calls. Explain the terminal must stay open.
2. **Check setup:** the published CLI's `doctor`, what its checks mean, and links
   to Node, Docker, uv, and Harbor prerequisites.
3. **Run an evaluation:** Harbor 0.22.0 executes a reviewed job configuration;
   show separate review, run, and local-results commands. Clearly identify
   placeholders and model usage. Do not invent `heval run` or imply the public
   npm release includes the connected-runner preview.
4. **Keep results:** explain local Bundle/SVG/PNG downloads versus normalized
   JSON imports saved privately to the signed-in account. Link to Reports and
   explain Save draft. Mention the source-only connected runner as optional.

Each command has a copy button. Next/Back change the guide step, not the user's
machine. Completion means the guide was read, not that a run was verified.
Save progress, completion, and skip decisions in Convex using the authenticated
subject; never accept an owner ID from the browser. Resume interrupted guides.
Terminal statuses cannot be reset by stale tabs. Completed/skipped accounts go
straight to their workspace on subsequent visits, including other browsers.

Studio's CLI guide link opens the guide in a new tab with the chart URL intact,
so reopening help does not discard unsaved work. Storage errors offer retry
and a clearly labelled way to continue without saving progress. No paid runs,
software installation, or pairing happen automatically.

Validate account isolation and transitions with Convex tests; test first visit,
resume, skip, completion, reopening, copy, mobile layout, keyboard navigation,
storage failure, and original destination preservation in the browser. Retain
the real AuthKit callback/reload regression test. Verify the deployed bundle and
that the new Convex endpoint denies anonymous access before shipping.
