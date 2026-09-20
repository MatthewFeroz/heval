# Codex, Claude Code and Pi on your evaluation worker

For a guided first run with architecture diagrams and checkpoints, start with
[the step-by-step smoke walkthrough](three-agent-smoke-walkthrough.md).

Use your own approved Linux machine as the worker, or use a separate Linux VM.
Docker runs on that worker. Your browser may run on the same computer or another
computer. A Mac/Windows host can use a Linux VM as the connected worker; the
current Heval daemon requires Linux. Direct Harbor execution is another option.

```text
Browser -> hosted Heval / Convex <- outbound HTTPS <- Linux worker
                                                      |
                                                Heval + Harbor
                                                      |
                                                Docker task
                                                      |
                                           Codex / Claude / Pi
                                                      |
                                           worker vendor proxy
                                                      |
                                             Merge -> DeepSeek
```

Harbor installs the pinned agent inside each task environment. Your normal host
CLI login/config is not the experiment configuration. No model GPU is needed.
The comparison changes the harness; all three use DeepSeek, not their vendors'
respective default models. Merge API credentials fund these runs; this setup does
not use ChatGPT or Claude subscription sessions.

## 1. Prepare the worker

Use the updated checkout and Harbor 0.23.0, Node 22+, Bun, Docker Engine and
Compose. Reserve ample disk for images and results before running. This checkout's
current VM is nearly full and has no Docker, so it cannot run the tasks yet.

```bash
source harbor/deepseek-study/activate.sh
harbor --version
docker info
docker compose version
bun run cli:build
node packages/cli/dist/cli.js doctor
```

The source-built CLI includes Pi profile support. An older npm/global CLI will
not automatically acquire it. You only need the three approved agents for this
workflow; the broader nine-agent bootstrap is not required.

## 2. Pair and check Docker

Use a Heval deployment with WorkOS and Convex configured. Open `/machines`, sign
in and create a pairing code. Run the displayed connection command, using this
checkout's CLI:

```bash
node packages/cli/dist/cli.js runner connect --url https://YOUR-DEPLOYMENT.convex.cloud
node packages/cli/dist/cli.js runner start
```

Paste the pairing code when prompted. Wait for Online in the browser, then run
**Check this machine**. That uses an Oracle reference solution, no inference.
Check the saved report before trying model-backed profiles. Stop the daemon with
Ctrl+C when idle so you can restart it below with the new registry. Keep the same
state directory; do not pair it again.

## 3. Keep the Merge key on the worker

Create a private credential file outside the repository. The following Bash
commands write a NEW file and refuse to overwrite an existing one:

```bash
mkdir -p "$HOME/.heval"
read -rsp 'Merge Gateway API key: ' HEVAL_STUDY_KEY; echo
export HEVAL_STUDY_KEY
python3 - <<'PY'
import os
from pathlib import Path
key = os.environ['HEVAL_STUDY_KEY']
if not key or any(c.isspace() for c in key):
    raise SystemExit('Expected a non-empty API key without whitespace')
p = Path.home() / '.heval/merge-study.env'
fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as f:
    for name in ('OPENAI_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'DEEPSEEK_API_KEY'):
        f.write(f'{name}={key}\n')
print(f'Credential file created: {p}')
PY
unset HEVAL_STUDY_KEY
```

All three variables hold the SAME Merge credential. Pi's Harbor adapter selects
`DEEPSEEK_API_KEY` because the model has a `deepseek/` prefix; its base URL is
explicitly overridden to Merge via the proxy. This does not send the key to
DeepSeek's first-party API. The connected supervisor uses the profile's envFile,
not arbitrary credentials exported in the daemon shell.

## 4. Prepare three comparable profiles

Verify `deepseek/deepseek-v4.1-flash` and an available vendor using your
authenticated Merge catalog. Use that same vendor for all three harnesses.
Determine the worker address reachable from task containers. Native Linux often
uses a Docker bridge gateway; Docker Desktop often provides host.docker.internal.
Do not assume `localhost` inside a task container reaches the worker.

In one worker terminal start the existing proxy:

```bash
bun harbor/proxy/vendor-proxy.ts --vendor VERIFIED_VENDOR \
  --log harbor/deepseek-study/local/three-agent-proxy.jsonl
```

Replace VERIFIED_VENDOR with the actual catalog value. Restrict the proxy port
to the container/private network; it listens on all interfaces and forwards the
credential. Keep it running while trials execute. Inspect its served-vendor logs:
a requested pin alone does not prove the actual serving vendor matched.

Generate the pilot in another terminal. Replace the example IP with your verified
container-reachable worker address:

```bash
python3 harbor/deepseek-study/prepare.py --include-pi \
  --vendor VERIFIED_VENDOR --proxy-url http://172.17.0.1:8787 \
  --task packages/cli/runner-task \
  --output harbor/deepseek-study/local/three-agent-pilot.json

harbor run -c harbor/deepseek-study/local/three-agent-pilot.json --print-config

python3 harbor/deepseek-study/runner-profiles.py \
  --pilot harbor/deepseek-study/local/three-agent-pilot.json \
  --env-file "$HOME/.heval/merge-study.env" \
  --output-dir "$HOME/.heval/deepseek-three-profiles"
```

The output directory must be new. This creates one approved profile per harness,
all sharing the same task, model, vendor and 900-second agent timeout. Each has
one attempt and a 30-minute overall deadline, including setup/grading. These are
connection pilots, not capability measurements or equal reasoning-token budgets.
The Pi profile uses `model_api: openai-completions`; Codex uses Responses and
Claude Code uses Messages. Multi-turn reasoning/tool calls through all three
surfaces still need live verification.

## 5. Start and switch agents in the browser

```bash
node packages/cli/dist/cli.js runner start \
  --profiles "$HOME/.heval/deepseek-three-profiles/profiles.json"
```

In `/machines`, select the worker. Under **Approved evaluation**, choose:

- DeepSeek V4.1 Flash / codex
- DeepSeek V4.1 Flash / claude-code
- DeepSeek V4.1 Flash / pi

Start each evaluation. One runs at a time on this worker; additional jobs queue.
Switching means selecting a profile for a NEW run, not changing the agent halfway
through an active task. Keep the worker and proxy running; you can close the
browser. Reports save to the workspace; raw logs remain under
`~/.heval/runner/runs/<run-id>/jobs/evaluation`.

After each pilot passes, select a benchmark, replace the tiny setup task with the
same pinned task set for all three profiles, increase attempts, and review new
profile digests before launching. For a single combined comparison artifact,
use the generated multi-agent Harbor job directly with `--env-file` and normalize
its output. Browser-launched profiles currently produce separate reports; a
combined cross-run report is not automatically assembled by this setup.

## Terminal-only alternative

You can skip pairing, Convex and sign-in completely while keeping Docker on the
same worker. With the proxy running and the pilot generated:

```bash
harbor run -c harbor/deepseek-study/local/three-agent-pilot.json \
  --env-file "$HOME/.heval/merge-study.env"
bun run report jobs/deepseek-v41-protocol-pilot
bun run studio:local
```

The first command makes paid model calls. Choose a distinct job_name if a prior
job already used that name. This runs all three agents in one job, sequentially,
and produces a combined result for Heval. It is the simplest initial comparison.
