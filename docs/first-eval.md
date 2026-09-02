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
- Pinned evaluation runner: Harbor 0.22.0 (see [`harbor/toolchain.json`](../harbor/toolchain.json))
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
- Pinned toolchain versions, including the Harbor and sandbox-provider versions
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

### Harbor agent wiring

Harbor resolves provider credentials declaratively from `harbor/agents/model_connection.py`, so the
gateway is configured through env vars on each agent rather than hand-written harness config files.
Both relevant agents pin their provider and ignore the model slug prefix when routing:

| Harbor agent | Pinned provider | Base URL var | Key var |
| --- | --- | --- | --- |
| `codex` | `openai` | `OPENAI_BASE_URL` | `OPENAI_API_KEY` |
| `claude-code` | `anthropic` | `ANTHROPIC_BASE_URL` | `ANTHROPIC_API_KEY` or `ANTHROPIC_AUTH_TOKEN` |

Agent config `env` takes precedence over the process environment, so base URLs are committed in the
job configs under [`harbor/jobs/`](../harbor/jobs/) while keys are supplied at run time via
`--env-file`. Codex does not honor `OPENAI_BASE_URL` alone; Harbor writes the resolved value into
`$CODEX_HOME/config.toml` as `openai_base_url`.

Leaving it at that keeps Codex on its built-in `openai` provider, which has websockets enabled. Codex
then dials `wss://api-gateway.merge.dev/v1/openai/responses`, the gateway answers 403, and every
trial burns eight failed connects and five reconnect attempts before falling back to HTTPS. Declaring
a custom provider with `supports_websockets = false` removes it — reproduced and fixed on 2026-09-02,
0 websocket attempts and 0 403s afterwards:

```yaml
- name: codex
  kwargs:                      # `config` is only forwarded through `kwargs`;
    config:                    # a top-level `config:` key is silently dropped
      model_provider: merge-gateway
      model_providers:
        merge-gateway:
          base_url: http://host.docker.internal:8787/v1/openai
          env_key: OPENAI_API_KEY
          wire_api: responses
          supports_websockets: false
```

Harbor merges its own `openai_base_url` on top of this; the custom provider's `base_url` wins, and
that combined shape is the one verified end to end.

### Serving vendor

Merge Gateway chooses which vendor serves a model unless the request body names one, and the default
is not the fastest. On `zai/glm-5.3-flash` the unpinned route went to `zai` at ~36 tok/s while
`particle` served the same model at ~184 tok/s for the same price. Vendor is therefore part of the
eval specification: unpinned latency and cost are not attributable to the model.

The gateway accepts the pin only as a JSON body field (`vendor`) — `x-merge-vendor` and `x-vendor`
headers were probed and silently dropped — and no harness can inject a body field. So
[`harbor/proxy/vendor-proxy.ts`](../harbor/proxy/vendor-proxy.ts) inserts it, reading the model →
vendor map in [`harbor/proxy/pins.json`](../harbor/proxy/pins.json). Pins are per-model because no
single vendor serves every model in a sweep. Each response's `x-merge-vendor` is logged next to the
pin that was sent, so the routing is auditable after the fact rather than assumed.

### Task selection

`n_tasks: N` takes the first N of the 89 Terminal-Bench 2.0 tasks in registry order, which is how an
earlier run drew `gpt2-codegolf` — 2400 expert-minutes against a 900 s agent cap, unwinnable by
construction — and spent its budget timing out. Tasks are instead selected on the metadata each
`task.toml` carries: `expert_time_estimate_min` inside the agent cap, `timeout_sec` low enough to
exclude heavy-compute builds, then drawn round-robin across `category` so no category dominates.

OpenCode and Pi are deferred rather than removed. `opencode --version` returns empty output on the
current machine and Pi is absent until `bun install` runs, so neither installed version can be
verified against its pin. Their gateway wiring notes above remain accurate for when they return.

## Current status

No evaluation has been published. The JSON files in `results/concurrent-cache-v1-*.json` are
development fixtures used to exercise the planned result shape; they are not measured benchmark
evidence, and the landing page's replay uses synthetic trajectories to demonstrate the product.

Real Harbor trials do exist locally. `jobs/terminal-bench-glm53-smoke` is a 2 × 2 smoke run
(Codex and Claude Code × Claude Sonnet 4.5 and GLM-5.3 Flash) on the Terminal-Bench `fix-git`
task, one trial per cell, all four passing. Its normalized rows are exported under
[`results/harbor/`](../results/harbor/) and are what the report builder and graph editor read.
One trial per cell on one task is pipeline validation, not evidence; the full 2 × 2 job in
[`harbor/jobs/terminal-bench-glm53-2x2.yaml`](../harbor/jobs/terminal-bench-glm53-2x2.yaml)
(60 trials) is the first run intended to produce a spread worth reporting.
