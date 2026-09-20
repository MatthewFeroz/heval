# DeepSeek V4.1 Flash harness study (Merge Gateway)

**Live smoke update, 2026-09-17:** Codex, Claude Code and Pi each passed the
one-task pilot on a Linux worker container in the Mac’s Docker Desktop. Merge
served DeepSeek V4.1 Flash through particle, confirmed on all 11 generation
requests. The paired account received all three reports. This is pipeline
validation, not benchmark evidence. See [the measured write-up](../../docs/blog/three-harnesses-one-model-macbook-worker.md)
and [worker recipe](../../deploy/docker-desktop-worker/README.md). The original
preparation notes below describe the state before this live test.

Prepared 2026-09-17. This is setup and an experimental protocol, **not completed
benchmark evidence**. Nine harness CLIs pass version checks on this ARM VM.
Docker is absent, disk is almost full, authenticated model routing is unverified,
and some harness adapters remain to be implemented. No paid inference was run.

For the focused Codex/Claude Code/Pi workflow, see
[Three-agent worker setup](../../docs/three-agent-worker.md).

## Model and execution architecture

Use Merge's catalog ID `deepseek/deepseek-v4.1-flash`. Do not reuse the older
`deepseek/deepseek-v4-flash` comparison in this repository. First-party DeepSeek
calls its current model `deepseek-flash`; that is not the Gateway catalog ID.
The public catalog documents V4.1; the authenticated `/v1/models` endpoint
returned 401 without a key, so account availability and vendor are still unknown.

```text
Harbor on worker -> disposable task container -> harness CLI
                                                |
                              vendor-pinning proxy on worker
                                                |
                                         Merge Gateway
                                                |
                                same DeepSeek model + vendor

Harbor jobs -> bun run report -> Heval local Studio
```

The model runs at the serving provider. A local GPU is not required. Harbor
installs agents inside task containers; having a CLI on the host is useful for
inspection but is not sufficient to make an evaluation runnable. Heval's old Bun
worker and its browser allowlist are a separate execution path. Adding a homepage
logo does not implement a Harbor adapter or enable a browser runner.

## Harness inventory and eligibility

| List ID | Display name | Logo | Downloaded version | Harbor 0.23.0 / remaining work |
| --- | --- | --- | --- | --- |
| `claude` | Claude Code | `claude.svg` | 2.1.270 | Built-in `claude-code`; Anthropic Messages through Merge; included in pilot |
| `opencode` | OpenCode | `opencode.svg` | 1.18.30 | Built-in `opencode`; custom provider configuration and reasoning round trip need smoke test |
| `antigravity` | Antigravity | `antigravity.png` | CLI 1.2.5 | `antigravity-cli` and `antigravity-sdk` are distinct adapters; documented custom endpoint is Gemini-compatible; no verified DeepSeek/Merge route |
| `codex` | Codex CLI | `codex.svg` | 0.154.0 | Built-in `codex`; Responses through Merge; included in pilot |
| `grok` | Grok Build | `grok.svg` | 1.0.34 | Built-in `grok-build`; CLI supports custom models, but pinned Harbor adapter has hard-coded provider URLs that require adaptation for Merge |
| `pi` | Pi Agent | `pi.svg` | 0.85.1 | Built-in `pi`; custom endpoint requires `model_api`, e.g. `openai-completions`; routing and reasoning need smoke test |
| `cursor` | Cursor | `cursor.svg` | 2026.09.15-d2fe57e | Built-in `cursor-cli`; custom Merge route from CLI is not verified; `--endpoint` alone is not proof of OpenAI compatibility |
| `deep-agents` | Deep Agents | `deepagents.svg` | deepagents-code 0.1.70; SDK 0.7.15 | Coding CLI is now `dcode` / `deepagents-code`; custom installed-agent adapter or verified ACP integration needed |
| `deepseek` | DeepSeek Harness | `deepseek.svg` | dsh 0.1.5-rc.2 | Official `@deepseek-ai/dsh`; custom installed-agent adapter or verified ACP integration needed |

The legacy `deepagents-cli` package now provides deployment tooling; it was
removed after inspection and replaced with `deepagents-code`. DeepSeek Harness
and Deep Agents are independent products. DeepSeek's `headless` and `sdk-minimal`
profiles are also distinct treatments; do not label their scores interchangeably.
`dsh --profile headless "instruction"` is the documented one-shot launcher.
Version/help checks do not verify native subprocess tools: npm reported blocked
install scripts for dsh dependencies, including subprocess-local, koffi and
node-pty. Review and enable the required scripts in the isolated prefix before
native execution, then test file creation plus shell execution in a sandbox.

## Use the installed tools

From the repository root, in Bash:

```bash
source harbor/deepseek-study/activate.sh
python harbor/deepseek-study/doctor.py
harbor --version
dsh --version
dcode --version
cursor-agent --version
```

Activation uses the downloaded Cursor executable instead of the pre-existing
broken mise launcher. It does not put Cursor's bundled Node on the global PATH.
Grok, Cursor, Antigravity and dsh live in `.tools/deepseek-study/`; uv installs
Harbor and Deep Agents in user tool environments. Existing working Claude,
Codex, OpenCode and Pi installations were preserved. The Antigravity installer
also appended this checkout's `.tools/deepseek-study/bin` to `.bashrc` and
`.bash_profile`; activation is still required for the full tool set.

`inventory-2026-09-17.json` records observed versions and machine paths.
Python freeze files and the dsh npm lock record resolved dependencies. They are
installation evidence, not a claim that complete container images are pinned.
Do not run broad auto-updates halfway through the experiment.

## Machine requirements and portability

This VM is aarch64, ~8 GiB RAM, 24 GiB disk. After installing the requested CLIs,
less than 1 GiB remained. Do not build benchmark images here until you expand the
disk. A practical starting allocation is 100 GiB disk, 16–32 GiB RAM and 4–8
vCPUs, with concurrency initially 1. Actual requirements come from each task's
manifest. Use x86_64 Linux if your chosen task images or tools lack ARM builds.
Do not mix native and emulated runs in a latency comparison.

On a larger Linux worker:

1. Install Docker Engine + Compose for its distribution and verify `docker info`
   as the evaluation user. Check task image architecture before selecting tasks.
2. Install Git, Python 3, Node, npm, uv and Bun 1.4.0.
3. Transfer this checkout, including these new files and any desired uncommitted
   work. Exclude `.tools`, `node_modules`, `.env*`, `data`, and raw `jobs` from a
   source transfer. Transfer credentials separately. `git clone` alone will not
   include uncommitted preparation files.
4. Run `bun install --frozen-lockfile`, then
   `bash harbor/deepseek-study/bootstrap.sh`. Core installs are version pinned;
   Python dependencies use the recorded freezes. Cross-platform native wheels
   can differ, so archive the new inventory too.
5. Download native Grok/Cursor/Antigravity builds for the destination architecture.
   Do not copy ARM binaries to x86_64. Use the official links below. Select Grok
   1.0.34 and Cursor 2026.09.15-d2fe57e; Antigravity's installer resolves latest,
   so verify it is 1.2.5 or declare a new study version. Pin downloaded checksums
   and preserve installers/binaries before running trials.
6. Source `activate.sh`, run `doctor.py`, then execute the pilot below.

Official native installation entry points (download and review before execution):

- Grok: `https://x.ai/cli/install.sh` (accepts version argument `1.0.34`).
- Cursor: `https://cursor.com/install`; versioned archives at
  `https://downloads.cursor.com/lab/2026.09.15-d2fe57e/linux/arm64/agent-cli-package.tar.gz`
  (use `x64` on x86_64). Keep its bundle together; the launcher needs its own Node.
- Antigravity: `https://antigravity.google/cli/install.sh`; this downloaded
  installer accepts `--dir`, although its online docs describe different flags.

The old YAML jobs contain `/Users/mattferoz/...` task paths and are not portable.
Use copied content-addressed tasks and regenerate paths on the destination.
`prepare.py` intentionally resolves the task path on the machine where it runs.
For artifact portability, archive task files, their SHA256 hashes, base image
**digests**, generated config, CLI versions, dependency locks and raw job output.

## First pilot: validate the protocol before comparing scores

The generated pilot includes Codex and Claude Code on the repository's tiny
setup task (two trials). This tests tool use and grading, not capability.
OpenCode/Pi and the other harnesses should be added only after their own adapters
pass the same test. Current defaults deliberately remain visible: this pilot
is not a claim of equivalent reasoning settings.

Set the key without putting it in shell history:

```bash
read -rsp 'Merge Gateway key: ' HEVAL_GATEWAY_API_KEY; echo
export HEVAL_GATEWAY_API_KEY
export OPENAI_API_KEY="$HEVAL_GATEWAY_API_KEY"
export ANTHROPIC_AUTH_TOKEN="$HEVAL_GATEWAY_API_KEY"
```

Query `https://api-gateway.merge.dev/v1/models` with Bearer authentication using
your credential manager/client. Save the V4.1 entry (no credentials) and verify
tool calling, Responses and Messages support, context limits and offered vendors.
Pick ONE vendor that works across all admitted harnesses. Do not reuse `particle`
from the old V4 comparison without checking the new entry. Verify multi-turn
reasoning/tool-result replay: this repository previously observed DeepSeek routes
rejecting missing `reasoning_content` on later turns. A successful first response
is insufficient.

Start the repository's existing proxy with that vendor in a separate terminal:

```bash
source harbor/deepseek-study/activate.sh
# Replace VERIFIED_VENDOR with the catalog value.
bun harbor/proxy/vendor-proxy.ts --vendor VERIFIED_VENDOR \
  --log harbor/deepseek-study/local/proxy.jsonl
```

The proxy listens on all interfaces at port 8787. Restrict it to the worker's
container/private network; requests carry the Gateway credential. The proxy logs
reported vendors, but does not fail closed on a mismatch. Reject affected trials
if the served vendor is missing or differs from the selected vendor.

Find a container-reachable host address. Docker Desktop often provides
`host.docker.internal`; native Linux does not guarantee it. Inspect your Docker
network's gateway or explicitly configure host-gateway mapping. The example
below uses a common address; replace it with the verified address on your worker.

```bash
python harbor/deepseek-study/prepare.py \
  --vendor VERIFIED_VENDOR --proxy-url http://172.17.0.1:8787 \
  --task packages/cli/runner-task
harbor run -c harbor/deepseek-study/local/pilot.json --print-config
# The next command incurs inference charges; run after Docker/routing checks.
harbor run -c harbor/deepseek-study/local/pilot.json
bun run report jobs/deepseek-v41-protocol-pilot
bun run studio:local
```

Open the URL printed by local Studio and import the normalized export. This local
analysis path does not need WorkOS sign-in. Keep raw `jobs/` artifacts as well.
Before sharing configs or logs, inspect them for credentials and task secrets.

## Comprehensive experimental design

Pre-register two questions separately:

- **Primary:** effect of changing the complete harness with V4.1 Flash, vendor,
  tasks, hardware, network and external budget held fixed. Native prompts, tools,
  planning and compaction are part of this treatment.
- **Secondary ablations:** within one harness, change one factor at a time:
  reasoning effort, context/compaction, subagents, memory, tool set or retry policy.
  A prompt-normalized minimal loop can be another baseline, with its own label.

Start with 5–10 diverse tasks and three attempts for pipeline validation. For the
main study, select the task set before inspecting scores: ideally a full pinned
benchmark release plus an independent repository-editing benchmark. Stratify by
language, bug fixing, implementation, build/debugging and long-context work.
Terminal-Bench alone cannot support claims about all coding workloads. For a
planning estimate, 9 eligible harnesses × 50 tasks × 5 attempts = 2,250 trials;
reduce the harness count if compatibility gates exclude some. Choose the final
sample size using pilot variance and a predeclared smallest meaningful effect.

Randomize harness order in task/repetition blocks; interleave across time to
limit provider load, cache and alias-drift effects. Save the schedule/seed.
Fresh container, session and home directory per trial; no inherited user skills,
MCP servers or cross-task memory. Match permission policy, CPU, RAM, task timeout,
network access and external token/dollar caps. Native reasoning labels such as
“high” are not equivalent across APIs: record translated request bodies and
provider settings, and report remaining mismatches. If equal token caps are
unavailable, compare equal wall-clock/dollar budgets and disclose the limitation.

Keep a second realistic-defaults track if desired, separately labelled. Do not
silently swap model, vendor or reasoning mode to make one harness work. Exclude
unsupported combinations from the primary comparison and report coverage.

Capture per trial: task/content/image hashes, harness and adapter versions,
model requested and returned, API protocol, served vendor, effective config and
system prompt hash, raw trajectory, tool calls, file diff, test output, reward,
exit/timeout status, input/output/reasoning/cache tokens, billed cost, queue time,
agent time and verifier time. Preserve missing costs as null, not zero. Join
Gateway request/accounting records instead of relying only on stale rate cards.

Define retry policy in advance. Keep infrastructure failures separate from agent
failures; report both end-to-end reliability and conditional success. Never drop
hard failures selectively. Include timeouts and all attempts in total cost; report
latency over all trials as well as over successful ones to avoid survivor bias.

Report paired success-rate differences and task-clustered bootstrap confidence
intervals, cost per successful task (all trial spend / successes), p50/p95 runtime,
tool errors, retries, context compactions and failure categories. Repetitions are
nested in tasks, not independent tasks. For one binary result per task, exact
McNemar is suitable; repeated outcomes require task-aware analysis. Correct for
multiple pairwise comparisons and avoid declaring a winner from overlapping,
underpowered estimates. Heval's existing single-series intervals are useful for
viewing results but are not a substitute for a paired repeated-trial analysis.

Budget the full study from the pilot's measured median AND tail cost. Set an
external spend ceiling before launch. Model aliases and vendor backends can
change even with fixed CLI versions: record dates and provider response metadata.

## Remaining engineering gates

- Docker/Compose and sufficient disk on the worker; image architecture verified.
- Authenticated Merge catalog and vendor verification; multi-turn smoke tests.
- dsh native dependency installation and explicit Merge provider/profile config.
- Deep Agents and dsh Harbor adapters: pinned installation, noninteractive run,
  isolated config, cancellation, logs/ATIF, version and usage extraction. ACP is
  a possible integration route, not an already-tested adapter.
- OpenCode/Pi provider options; Grok adapter custom endpoint support.
- Prove Cursor and Antigravity can use the exact Merge model; otherwise exclude.
- Full experiment scheduler, budget enforcement and task-clustered statistical
  analysis are described here, not implemented by the small pilot generator.

## Primary references

- [Merge model catalog](https://docs.merge.dev/merge-gateway/models/catalog)
- [DeepSeek model naming](https://api-docs.deepseek.com/updates/)
- [DeepSeek Harness CLI](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/cli/README.md)
- [Codex custom providers](https://developers.openai.com/codex/config-advanced/)
- [Grok custom models](https://docs.x.ai/build/overview)
- [Deep Agents model providers](https://docs.langchain.com/oss/deepagents/code/providers)
- [Antigravity installation and provider support](https://antigravity.google/docs/cli/install/)
- [Cursor CLI](https://cursor.com/cli)
- [Harbor agents](https://docs.harborframework.com/)

Use `harbor agent list` and `harbor agent schema AGENT` to inspect the
installed 0.23.0 adapters. The earlier 0.22.0 installation lacked these commands.
The pin was upgraded before any paid study trials; prior benchmark evidence
retains its recorded runner version.
