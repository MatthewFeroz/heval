# First real evaluation

## Question

How do current coding-agent stacks differ when repairing the same TypeScript concurrency defect under the same environment and budget?

This produces two explicitly different result sets:

1. **Stack race:** each harness with its recommended/native model. This answers what a developer should use, but does not isolate the harness as the cause.
2. **Harness isolation:** Claude Code, Codex, OpenCode, and Pi with the same dated Anthropic model and budget through Merge Gateway. Merge exposes the Anthropic Messages surface Claude Code needs and the OpenAI-compatible surfaces used by the other harnesses.

## Task

`concurrent-cache-v1` contains a deliberately incorrect asynchronous cache. The public instruction asks the agent to coalesce concurrent cache misses while preserving the API. The grader covers successful loads, concurrent calls, per-key isolation, rejection cleanup, retry behavior, and type/API compatibility.

The first publication will include the complete task and grader. Every later rerun pins their content digests so historical results remain interpretable.

## Protocol

- Clean environment per trial
- Fixed 96 × 24 PTY
- Pinned harness and model versions
- Identical CPU, memory, timeout, and task files
- Three attempts per stack for the first article
- Randomized execution order
- Executable grading; no LLM judge in v1
- Raw PTY, patch, grader output, exit status, duration, and usage retained
- Failures and incomplete runs remain visible

## Publishability gate

A result is not public unless it contains:

- Run manifest and content hashes
- Raw timestamped trajectory
- Initial and final filesystem state
- Patch
- Grader output
- Harness exit status
- Model usage and cost when the provider exposes them
- Explicit limitations

## Merge Gateway authentication

- Claude Code: `ANTHROPIC_BASE_URL` plus `ANTHROPIC_AUTH_TOKEN`; inherited `ANTHROPIC_API_KEY` must be cleared.
- Codex: isolated `model_providers.merge-gateway` configuration using the Responses wire API.
- OpenCode: registered `merge-gateway` provider plus `MERGE_GATEWAY_API_KEY`.
- Pi: isolated `models.json` custom provider plus `MERGE_GATEWAY_API_KEY`.

Pi's API-key syntax is version-sensitive. Current Pi 0.84.x uses
`"apiKey": "$MERGE_GATEWAY_API_KEY"`. The pinned legacy
`@mariozechner/pi-coding-agent` 0.73.1 used in the first smoke run requires the bare environment
variable name: `"apiKey": "MERGE_GATEWAY_API_KEY"`. Merge's main documentation example should
remain current, but should state the minimum supported Pi version and include this legacy note.

No paid trial should be started until all requested configurations resolve to the intended model IDs.

## First smoke result

One real attempt from each harness passed the executable grader on August 30, 2026. The measured
run metadata is stored in [`results/concurrent-cache-v1-smoke.json`](../results/concurrent-cache-v1-smoke.json).
This is pipeline validation, not a publishable ranking: it has one attempt per harness, one exposed
grader test, approximate completion durations, and no joined provider-cost records yet.
