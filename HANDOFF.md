# Handoff: Merge Gateway routing for Factory, Cursor and Devin

Branch `feat/factory-droid-harbor-0.24`. Delete this file before merging.

## Goal

Run Factory Droid, Cursor and Devin (Cognition) as Heval/Harbor profiles whose
model calls go through Merge Gateway, so routing can be tested in each product.

## Done in commit b27bb8b

- Harbor pinned to 0.24.0 (latest on PyPI) across toolchain, CI, docs, tests.
  `packages/cli/worker/requirements.txt` regenerated for Linux; only `harbor`
  changed and `semver` was added.
- Factory Droid Merge profile. Bundled adapter `FactoryDroid` in
  `packages/cli/worker/heval_agents.py` installs `droid@0.247.0`, writes
  `~/.factory/settings.json` with one `customModels` entry
  (`baseUrl` https://api-gateway.merge.dev/v1/openai, `provider: "openai"`,
  `apiKey: "${OPENAI_API_KEY}"`), and runs
  `droid exec --skip-permissions-unsafe --model custom:Merge-Gateway-0 -o stream-json`.
  Verified locally that Droid needs no Factory login (a fake key got Merge's own 401).
- `merge.ts` has `bundledAgents`; `profiles.ts` accepts bundled Merge adapters.
- Catalog/UI: `factory-droid` added with logo; `cursor` and `devin` are
  `merge: false` with reasons. Landing hero and copy updated.
- Tests: `bun run cli:test` passes except a pre-existing macOS-only failure in
  `runner.test.ts` (process start time). Lint and typecheck pass.

## In progress: Cursor can route through Merge

The public `cursor-agent` rejects custom endpoints, but Cursor publishes a
separate build, `agent-cli-local`, at the same CDN path:

    https://downloads.cursor.com/lab/<version>/<os>/<arch>/agent-cli-local-package.tar.gz
    # e.g. lab/2026.10.22-27dcf5f/linux/x64/agent-cli-local-package.tar.gz
    # current version string comes from `curl -fsSL https://cursor.com/install`

Its binary is `cursor-agent-local`. Hidden flags and env vars:

- `--authless` or `CURSOR_ENABLE_AUTHLESS=1`: no Cursor login or backend.
- `--base-url` or `CURSOR_LOCAL_AGENT_BASE_URL` (or `ANTHROPIC_BASE_URL`):
  "OpenAI-compatible or Anthropic Messages" provider URL.
- `--local-agent-api-key` or `CURSOR_LOCAL_AGENT_API_KEY` (or `ANTHROPIC_AUTH_TOKEN`).
- Also `CURSOR_LOCAL_AGENT_API_KEY_HELPER`, `CURSOR_LOCAL_AGENT_MAX_RETRIES`,
  `CURSOR_LOCAL_AGENT_REASONING_REPLAY`, Bedrock options.

Tested on the MacBook with a fake key:

    cursor-agent-local --authless --base-url https://api-gateway.merge.dev/v1/openai \
      --local-agent-api-key invalid-test-key --model openai/gpt-5-mini \
      --print --output-format stream-json --force "Reply with OK"

Result: `init` event, then `LocalProviderError: Unauthorized (HTTP 401) ...
(invalid_api_key: Invalid API key)`. That is Merge Gateway's error, so the
request reached Merge directly with no Cursor account.

Next steps:
1. One real call with a Merge key (ask Matt first; it bills credits) to confirm
   tool calls work and which endpoint (chat/completions vs Anthropic) it uses.
2. Add a bundled `CursorLocal` adapter like `FactoryDroid`: download the pinned
   linux package, run `cursor-agent-local --authless --print --output-format
   stream-json --force`, pass base URL and key via env. Harbor's built-in
   `cursor-cli` adapter can't do this (it hard-requires `CURSOR_API_KEY`).
3. Flip `cursor` to `merge: true` in `src/harness-catalog.json`, add to
   `mergeHarnesses`/`bundledAgents`, update tests and `docs/setup-command.md`.
4. Note: this is an unofficial, undocumented Cursor build. Say so in docs.

## Still to investigate: Devin

`curl https://cli.devin.ai/install.sh` → manifest at
https://static.devin.ai/cli/current/manifest.json (current 3000.11.92, has
linux/mac bundles). No documented custom endpoint. Harbor's adapter writes
`windsurf_api_key` and optional `api_server_url` to
`~/.local/share/devin/credentials.toml`; `api_server_url` replaces Devin's whole
backend. Next: download the bundle into a temp dir (don't run the installer)
and search the binary for hidden local/BYOK modes, same as was done for Cursor
(strings like base_url, byok, authless, local, openai, anthropic).

## Rules

- Don't run evaluations or real model calls without asking Matt.
- Cursor's installer overwrites `~/.local/bin/agent`; download packages into a
  temp dir instead.
