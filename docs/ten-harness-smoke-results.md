# Harbor harness smoke results — 2026-09-22

Six harnesses passed the common protocol smoke through Merge Gateway using DeepSeek V4.1 Flash. Factory Droid is deferred at the user's request. DeepSeek Harness now also passes with thinking disabled; Cursor and Antigravity have integration blockers.

These are direct Harbor 0.23.0 runs in the Linux ARM64 Docker worker on the Mac. The task creates `/app/hello.txt` containing exactly `hello from heval\n`, checked by a file verifier. This establishes basic integration, not Terminal-Bench Lite performance. No full dataset evaluation was started.

| Harness | Version | Result | Generation requests |
|---|---|---|---:|
| Claude Code | 2.1.270 | Passed | 5 |
| Codex CLI | 0.154.0 | Passed | 2 |
| Pi Agent | 0.85.1 | Passed | 4 |
| OpenCode | 1.18.30 | Passed | 6 |
| Grok Build | 1.0.34 | Passed | 6 |
| Deep Agents (`deepagents-code`) | 0.1.70 | Passed, including shell execution | 4 |
| DeepSeek Harness | 0.1.5-rc.2 | Passed with thinking disabled, including shell verification | 5 |
| Cursor CLI | 2026.09.18-9a7762b | Blocked before inference: missing Cursor credential; same-model Merge route unverified | 0 |
| Antigravity CLI | 1.2.8 | Blocked before inference: missing Gemini credential; Gemini-compatible Merge route unverified | 0 |
| Factory Droid | 0.224.1 | Deferred by user | 10 in earlier partial test |

All 27 generation requests from the six passing harnesses returned HTTP 200 with vendor `particle`, using the requested DeepSeek V4.1 Flash model. Provider names in Harbor metadata sometimes identify the wire protocol, not the underlying model vendor. Authentication probes and standalone routing probes are excluded from these counts.

DeepSeek Harness now passes with `llm-deepseek.thinking: "disabled"`. The successful job is `ten-smoke-deepseek-harness-2026-09-22-pinned-node-settings`: Harbor reward 1, no exception, and five generation requests returning HTTP 200 with the exact DeepSeek V4.1 Flash model and vendor `particle`. Its native output reports byte-for-byte verification using `od -c`.

The adapter fixes pin Node 22.23.2 for Linux ARM64, verify the official archive SHA-256, install the package's prebuilt dependencies without a compiler toolchain, and supply the thinking setting as a string. The earlier API-shaped object (`{"type":"disabled"}`) was incorrect for the harness settings schema and the run failed with missing credentials; the corrected string configuration passed. Earlier attempts also failed during compiler installation (exit 137) and NVM version discovery. Their underlying environmental causes were not established; the pinned-runtime installation avoids those paths.

The default reasoning-enabled request previously received Gateway HTTP 400 for the combination of reasoning, streaming tools, and tools. That Gateway behavior has not been fixed by these adapter changes. Disabling thinking is an explicit configuration difference and must be disclosed in a comparison. The CLI is pinned to 0.1.5-rc.2, but its dependency ranges resolved some internal packages to 0.1.5-rc.3; the successful trial's `agent/package-lock.json` retains the exact dependency graph.

Re-run the working smoke from `/Users/mattferoz/heval-smoke-worker` in the Linux worker with:

```sh
PYTHONPATH="$PWD/ten-harness-smoke-2026-09-22" harbor run \
  -c ten-harness-smoke-2026-09-22/deepseek-harness-pinned-node-settings.json \
  --env-file secrets/merge-study.env
```

Use a fresh job name for a new run. The saved configuration sets `kwargs.thinking` to `disabled`; the adapter does not silently change its default.

Factory's earlier file verifier returned reward 1, and BYOK requests reached Merge without an additional Factory credential. However, its shell tool repeatedly received SIGKILL; it completed using file tools. This is a partial integration result, not clearance for the coding evaluation. Further Factory work was stopped at the user's request.

Cursor account access alone would not prove custom Merge routing. Antigravity's documented custom endpoint uses the Gemini protocol; the existing OpenAI-compatible route does not establish compatibility. See [adapter research](ten-harness-smoke-adapter-notes.md) for primary documentation.

Reproduction artifacts are under `/Users/mattferoz/heval-smoke-worker/ten-harness-smoke-2026-09-22`; job outputs are under `/Users/mattferoz/heval-smoke-worker/jobs/ten-smoke-*`. Configurations reference the existing private environment file; credentials are not included here. [Selected result and routing evidence](evidence/ten-harness-smoke-2026-09-22.json) records paths, versions, verifier results, and request metadata.

The [custom adapters](../harbor/deepseek-study/smoke_adapters.py) are smoke-only: native logs are retained, but normalized trajectories and token/cost accounting are not implemented. They require more work before a scored study with comparable telemetry.
