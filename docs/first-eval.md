# First real evaluation

## Question

How do current coding-agent stacks differ when repairing the same TypeScript concurrency defect under the same environment and budget?

This produces two explicitly different result sets:

1. **Stack race:** each harness with its recommended/native model. This answers what a developer should use, but does not isolate the harness as the cause.
2. **Harness isolation:** Codex, OpenCode, and Pi with the same OpenAI model and budget. Claude Code is excluded because it cannot run that model.

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

## Required authentication

- Claude Code: configured
- Codex: configured
- OpenCode: provider login required
- Pi: `/login` with ChatGPT Plus/Pro (Codex) required

No paid trial should be started until all requested configurations resolve to the intended model IDs.
