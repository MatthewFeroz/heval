# DeepSeek Harness: actual before/after Harbor evidence

The reasoning-enabled DeepSeek Harness failed with the pre-fix Gateway functions and passed with the patched functions. Both runs executed the real CLI in Harbor against the same protocol-smoke task. After local capability checking and translation, inference went through live Merge Gateway to DeepSeek V4.1 Flash on particle.

| Measurement | Before | After |
|---|---|---|
| Gateway source revision | fa4b7aa9 | 3cbc16c7 |
| Harness | dsh 0.1.5-rc.2 | dsh 0.1.5-rc.2 |
| Main request | thinking enabled, effort high, streaming, 25 tools | Same |
| Main request routing | HTTP 400 capability_unavailable | HTTP 200, particle |
| Task reward | 0 | 1 |
| Agent exception | NonZeroAgentExitCodeError | None |
| Completed tool calls | 0 | 4 |
| Thinking text returned | 0 | 1,039 characters |

The two installed dependency lockfiles have the same SHA-256: `1395d0e0fcc5487f7f37668b1d7bdb3896db87b220f0e90ad890171f8d357aaf`. Both configurations use the same adapter, task, model, resource limits, and 240-second agent timeout. The patched trial made six successful requests: five main-agent requests with high effort, plus one session-title request with thinking disabled. The pre-fix trial's separate session-title request encountered an upstream 429; its main request independently failed the local capability filter with HTTP 400.

Before native log:

```text
dsh: INVALID_REQUEST: Model deepseek/deepseek-v4.1-flash has no vendor that supports the requested capabilities (['reasoning', 'streaming_tools', 'tools']).
```

After native log:

```text
Done. `/app/hello.txt` now contains exactly `hello from heval` followed by a newline (17 bytes, verified with `od -c`: trailing `\n` present).
```

Harbor independently graded the output file with reward 1; this is not based solely on the agent's completion message.

## Evidence

- [Before Harbor result](/Users/mattferoz/heval-smoke-worker/jobs/dsh-reasoning-ab-before/protocol-smoke__9Sj3K8m/result.json)
- [Before native CLI log](/Users/mattferoz/heval-smoke-worker/jobs/dsh-reasoning-ab-before/protocol-smoke__9Sj3K8m/agent/native.log)
- [After Harbor result](/Users/mattferoz/heval-smoke-worker/jobs/dsh-reasoning-ab-after/protocol-smoke__ogUeZFj/result.json)
- [After native CLI log](/Users/mattferoz/heval-smoke-worker/jobs/dsh-reasoning-ab-after/protocol-smoke__ogUeZFj/agent/native.log)
- [Structured comparison and stream measurements](/Users/mattferoz/heval-smoke-worker/deepseek-reasoning-fix/ab-summary.json)
- [Source/configuration manifest](/Users/mattferoz/heval-smoke-worker/deepseek-reasoning-fix/ab-manifest.json)
- [Original harness request](/Users/mattferoz/heval-smoke-worker/deepseek-reasoning-fix/after-request-1.json)
- [Translated upstream request](/Users/mattferoz/heval-smoke-worker/deepseek-reasoning-fix/after-translated-1.json)
- [Example captured response with thinking and a tool call](/Users/mattferoz/heval-smoke-worker/deepseek-reasoning-fix/after-response-3.sse)
- [Integration server source](/Users/mattferoz/heval-smoke-worker/deepseek-reasoning-fix/ab_server.py)

## Scope of proof

This is a branch-level integration test, not a deployment of the complete Gateway service. The local server imports the actual routing/translation functions from each git revision. It uses a declared capability fixture: public particle capability metadata plus `request_style: deepseek_thinking` as an explicit internal-metadata assumption. It forwards accepted, translated requests to live Merge for real inference. Production control-plane catalog state, authentication, billing and full API-handler behavior are not reproduced locally.

The response exposes reasoning under the Gateway `thinking` field. The original server counter only counted `reasoning_content`; the derived stream summary counts both fields and is authoritative for the 1,039-character measurement. This confirms returned model thinking; it does not independently establish how the CLI stores that field in conversation history.

PR https://github.com/merge-api/merge-gateway/pull/1253 remains undeployed. Its latest CI checks pass, including the full test job. This evidence demonstrates the patched branch's routing/translation plus real harness tool loop; the original production reasoning-enabled request still needs verification after deployment. No full Terminal-Bench Lite evaluation was started.
