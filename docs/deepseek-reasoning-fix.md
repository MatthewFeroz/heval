# DeepSeek Harness reasoning investigation

Draft fix: https://github.com/merge-api/merge-gateway/pull/1253 (base develop). Worktree: `/Users/mattferoz/merge-gateway-deepseek-thinking`, commit `cdcd5c5f`.

A minimal live request to Merge with the DeepSeek V4.1 Flash model, particle vendor, streaming tools and `thinking: {type: enabled}` still receives HTTP 400 `capability_unavailable`. A thinking-disabled control initially succeeded. Later disabled/high-effort probes received upstream HTTP 429, a separate availability blocker.

The current develop capability filter has an early return when a hosted model advertises a native thinking request style. For a hosted route with both `deepseek_thinking` and the supported `reasoning_effort` control, this rejects the route before checking the existing effort translator. The patch allows that alternative translation; routes without an available translator remain rejected. The live internal catalog request-style field has not been inspected, so this is a demonstrated code defect consistent with the observed rejection rather than proof of every deployed condition.

Validation: the new regression failed before the patch. After it, 54 focused routing, translation and backstop tests pass. Broader selection: 188 pass and 17 fail at an API-route circular import. Those 17 failures also reproduce with the unchanged develop capability module. Tests used an isolated test-dependency directory in the Harbor worker, whose LiteLLM differs from the repository's pinned fork; CI validation remains required.

No deployment or full evaluation was performed. Existing seven-harness configuration still explicitly disables thinking for DeepSeek Harness. After deployment, run the original reasoning-enabled streaming-tool probe, verify reasoning and tool output, then run the prepared reasoning-enabled Harbor smoke. Only promote that configuration into the benchmark after it passes.

Probe and results: `/Users/mattferoz/heval-smoke-worker/deepseek-reasoning-fix/probe.py` and `probe-results.json`. They read credentials from the private worker environment file; no credentials are recorded in this document.
