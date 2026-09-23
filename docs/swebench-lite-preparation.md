# Selected evaluation: SWE-bench Lite

The user selected SWE-bench Lite on 2026-09-22, replacing OpenThoughts-TBLite.
Use the exact 30-task subset in the HarnessTax comparison, three attempts per task.
The task IDs were recovered from the authors' published chart data and verified
against the pinned official 300-task Lite test split. All 30 Harbor tasks were
generated; a six-harness dry run accepted 540 trials. A later one-task Mac compatibility check completed; see the preparation directory’s COMPATIBILITY.md. No full evaluation was launched.

Preparation directory on the Mac and Linux worker:
`/Users/mattferoz/heval-smoke-worker/swebench-lite-2026-09-23`

Read its README.md and dataset-manifest.json before proceeding. Configurations
are explicitly drafts. Remaining preparation includes image/Oracle validation,
network isolation, consistent turn caps, high-effort routing, and cost accounting.
DeepSeek Harness needs reasoning-enabled Gateway validation before inclusion.
The exact cohort is established; full methodology equivalence is not.

Sources:
- https://arena.ai/blog/coding-agents-harness-tax
- https://harnesstax.github.io/data/charts/system-harness-effect-swe.f233b4a6e8.json
- https://www.swebench.com/lite.html
