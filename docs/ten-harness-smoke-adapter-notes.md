# Smoke adapter research

DeepSeek Harness subsequently passed with the pinned Node runtime and the string setting `llm-deepseek.thinking: "disabled"`. Its internal adapter dependency resolved to 0.1.5-rc.3; use the successful trial lockfile for exact versions.

Live execution results are recorded in [ten-harness-smoke-results.md](ten-harness-smoke-results.md); they supersede research-only assumptions below. Factory was subsequently deferred at the user’s request. Its initial BYOK run reached Merge without a Factory credential, but shell commands were killed, so it is not validated for the evaluation.

Checked 2026-09-22. These are implementation candidates verified against official documentation and published package sources. No model calls were made and no worker files were changed during this research. Replace `MERGE_BASE_URL` below with the existing worker's verified OpenAI-compatible endpoint, including its `/v1` path. Keep API keys in environment variables.

## DeepSeek Harness

Published npm version `@deepseek-ai/dsh@0.1.5-rc.2` exists. The downloaded CLI package and its matching `dsh-base`, `dsh-llm-deepseek`, `dsh-permission-presets`, and `dsh-agent-default-model` packages confirm the configuration below. Pin the top-level package and retain the resolved lockfile because its internal package dependencies use caret ranges. [Registry metadata](https://registry.npmjs.org/@deepseek-ai/dsh/0.1.5-rc.2)

Install in the disposable task container with `bun add --global @deepseek-ai/dsh@0.1.5-rc.2`. Run the installed CLI with a compatible Node runtime. Create an isolated `DSH_HOME` and write `$DSH_HOME/settings.yaml`:

```yaml
agent-default-model:
  provider: deepseek-official
  model: deepseek/deepseek-v4.1-flash
llm-deepseek:
  apiKeyEnv: MERGE_API_KEY
  baseURL: MERGE_BASE_URL
  maxTokens: 16384
permission:
  defaultPreset: danger-full-access
```

`baseURL` above is a rendered literal URL, not an environment variable reference. Then, from the task workspace:

```sh
DSH_PERMISSION_MODE=danger-full-access DSH_TELEMETRY_DISABLED=1 \
  dsh --profile headless "$PROMPT"
```

The exact `0.1.5-rc.2` native DeepSeek adapter passes the requested model identifier into Chat Completions and appends `/chat/completions` to `baseURL`. It has no `protocol` configuration field. Its settings schema includes `apiKeyEnv`, `baseURL`, `thinking`, `reasoningEffort`, and `maxTokens`. Neither `thinking` nor `reasoningEffort` has a schema default in this pin. If a fixed effort is required, set it explicitly and align it with the other harnesses. [Pinned adapter artifact metadata](https://registry.npmjs.org/@deepseek-ai/dsh-llm-deepseek/0.1.5-rc.2)

`agent-default-model` is the exact pinned settings namespace. Its settings schema requires `provider` and `model` and accepts optional `reasoningEffort`. The native provider name is `deepseek-official`; adapter settings namespace is `llm-deepseek`. [Pinned default-model artifact](https://registry.npmjs.org/@deepseek-ai/dsh-agent-default-model/0.1.5-rc.2)

The pinned headless startup parser only defines positional `[task...]` and `-h/--help`. Pass the entire prompt as an argument. It does not support `--json`, `--session-id`, or stdin task input. The launcher passes profile arguments through; the headless app rejects unknown options. The runner prints the final assistant text to stdout, reasoning to stderr, and exits 0 for a completed turn or 1 otherwise. Its Cordis runner config only contains `task`. [Pinned headless artifact](https://registry.npmjs.org/@deepseek-ai/dsh-headless/0.1.5-rc.2), [pinned launcher artifact](https://registry.npmjs.org/@deepseek-ai/dsh/0.1.5-rc.2)

Correction after the actual smoke attempt: the earlier note accidentally mixed newer `master` README behavior into this pinned configuration. That caused an unsupported `--json` flag and an unnecessary `protocol` field. The commands and settings above now follow the downloaded exact-version artifacts, not current branch documentation.

The matching base composition maps `DSH_PERMISSION_MODE=danger-full-access` to approval policy `never`. The `permission.defaultPreset` setting applies to newly created sessions. [Pinned base artifact](https://registry.npmjs.org/@deepseek-ai/dsh-base/0.1.5-rc.2), [pinned permission artifact](https://registry.npmjs.org/@deepseek-ai/dsh-permission-presets/0.1.5-rc.2)

Limitations: runtime and tool behavior still need a live smoke test. This composition also advertises DeepSeek web search using `DEEPSEEK_API_KEY`; do not populate that variable with the Merge key. The Merge route above deliberately uses `MERGE_API_KEY`. Generation routing still needs observation. Telemetry can be disabled with `DSH_TELEMETRY_DISABLED=1`, confirmed by the published base composition.

## Deep Agents

Use the official coding CLI `deepagents-code`, executable `dcode`, rather than a hand-built agent using only the SDK. Published version `0.1.70` exists and requires Python >=3.12, <4.0. Its source distribution confirms the flags and provider fields below. [PyPI version metadata](https://pypi.org/pypi/deepagents-code/0.1.70/json), [CLI project](https://github.com/langchain-ai/deepagents/blob/main/libs/code/README.md)

Install in an isolated Python environment with `uv tool install --python 3.12 deepagents-code==0.1.70`. The OpenAI model integration is part of the package dependencies. In isolated `~/.deepagents/config.toml`:

```toml
[models.providers.openai]
api_key_env = "MERGE_API_KEY"
base_url = "MERGE_BASE_URL"
models = ["deepseek/deepseek-v4.1-flash"]
```

Render the actual endpoint in `base_url`. Alternatively use `OPENAI_API_KEY` and `OPENAI_BASE_URL` without a provider override. Configuring `api_key_env` avoids copying the credential under another name. The provider loader resolves custom `base_url` and forwards model parameters to the OpenAI chat model. [Provider configuration source](https://github.com/langchain-ai/deepagents/blob/main/libs/code/deepagents_code/model_config.py), [model construction](https://github.com/langchain-ai/deepagents/blob/main/libs/code/deepagents_code/config.py)

```sh
dcode --model openai:deepseek/deepseek-v4.1-flash \
  --shell-allow-list all --no-mcp --non-interactive "$PROMPT"
```

Noninteractive mode disables shell execution unless the allow list is supplied. `all` permits local commands in the disposable task container. Do not substitute the interactive `--auto-approve` flag. `--no-mcp` avoids unrelated connector discovery. [Pinned package metadata and source archive](https://pypi.org/pypi/deepagents-code/0.1.70/json), [CLI flag source](https://github.com/langchain-ai/deepagents/blob/main/libs/code/deepagents_code/main.py)

Limitations: the CLI runs a local LangGraph server and has more dependencies than the SDK alone. Installation and a live run remain unverified here. Check all generation requests, including subagents and summarization, for the intended model and endpoint.

## Factory Droid

Factory's official installer currently pins `0.224.1` and supports Linux ARM64. Exact binary URL is `https://downloads.factory.ai/factory-cli/releases/0.224.1/linux/arm64/droid`; its checksum is the same URL plus `.sha256`. Download both, verify SHA-256, and record the version rather than relying on a later unpinned installer. [Official installer source](https://app.factory.ai/cli)

Write isolated `~/.factory/settings.json`:

```json
{
  "customModels": [
    {
      "model": "deepseek/deepseek-v4.1-flash",
      "displayName": "Merge DeepSeek",
      "baseUrl": "MERGE_BASE_URL",
      "apiKey": "${MERGE_API_KEY}",
      "provider": "generic-chat-completion-api",
      "maxOutputTokens": 16384
    }
  ]
}
```

The current settings format supports environment expansion in `apiKey`; the legacy snake_case `config.json` format does not. Generic Chat Completions is the appropriate provider for this OpenAI-compatible route. [Custom model documentation](https://docs.factory.ai/model-independence/byok)

```sh
droid exec --model custom:Merge-DeepSeek-0 \
  --skip-permissions-unsafe --output-format json --cwd /app \
  --file /tmp/instruction.txt
```

The model selector contains the normalized display name and zero-based array index. Use the actual task working directory. Headless documentation requires `FACTORY_API_KEY` for Factory authentication, separately from the custom model's key. An existing authenticated installation may also work, but that was not tested. The permission flag is documented for disposable containers and cannot be combined with `--auto`. [Headless documentation](https://docs.factory.ai/droid-exec/overview)

Limitations: custom model support does not establish that account authentication can be omitted. If Factory authentication is unavailable, report that blocker rather than claiming Merge is unsupported. No paid run or authentication test was performed by this research task.


## Cursor CLI follow-up

No supported direct OpenAI-compatible Merge route was verified for Cursor CLI. Its documented authentication is a Cursor account login or a Cursor-issued User API Key in `CURSOR_API_KEY`. A Merge key is not a substitute. [Current CLI authentication](https://cursor.com/docs/cli/reference/authentication)

The current parameter reference supplies `--model` and `agent models` for the models available to the account. Its documented global options do not include an OpenAI provider/base-URL setting. The older authentication page mentions `--endpoint`, but does not describe the request protocol or promise OpenAI compatibility. Do not configure `--endpoint` to Merge based on that flag name. [Current parameter reference](https://cursor.com/docs/cli/reference/parameters), [older authentication reference](https://docs.cursor.com/en/cli/reference/authentication), [CLI configuration](https://cursor.com/docs/cli/reference/configuration)

Cursor's general BYOK documentation is about the product's provider settings and says requests go through Cursor's servers for final prompt construction. It does not establish that the terminal CLI accepts arbitrary OpenAI-compatible model endpoints. [Product BYOK documentation](https://prod.cursor.com/help/models-and-usage/api-keys)

Actionable disposition for this study: mark Cursor CLI blocked on an unverified custom-provider route, plus Cursor authentication if absent. A valid Cursor account would permit a separate smoke run with its supported account models, but that would not establish DeepSeek V4.1 Flash through Merge. No authentication or model request was attempted during this follow-up.

## Antigravity CLI follow-up

Antigravity CLI supports a custom **Gemini-compatible** endpoint. The official installation guide explicitly uses that protocol description. It requires both `modelProvider: "gemini"` in `~/.gemini/antigravity-cli/settings.json` and `GEMINI_API_KEY`. Setting the key alone does not switch providers. Set `GOOGLE_GEMINI_BASE_URL` to the Gemini-compatible service root. This mode skips Google account sign-in. [Official installation and authentication](https://www.antigravity.google/docs/cli/install/)

```json
{
  "modelProvider": "gemini"
}
```

This was added in official release `1.1.13`, whose notes also confirm a fix for custom Gemini endpoint requests. There is no verified claim here that `GOOGLE_GEMINI_BASE_URL` changes the wire protocol to OpenAI Chat Completions. [Official release](https://github.com/google-antigravity/antigravity-cli/releases/tag/1.1.13)

For headless operation, the official command is `agy -p "$PROMPT" --model <known-slug> --output-format json --dangerously-skip-permissions`. `agy models` lists supported slugs. Unknown model selections fail rather than silently falling back; error text mentions models declared in settings, but this follow-up did not verify the schema for arbitrary custom model declarations. [Official headless reference](https://www.antigravity.google/docs/cli/headless/)

Actionable disposition: the existing Merge OpenAI-compatible endpoint alone is insufficient. A runnable same-model route requires a verified Gemini-compatible endpoint that maps to the exact DeepSeek model, or an explicit Gemini-to-OpenAI protocol translation layer plus a valid model declaration. Such a layer must preserve streaming, tool schemas, tool results, and reasoning metadata, and its use should be disclosed in benchmark methodology. Neither the translation path nor the custom model schema was validated here. No paid request was attempted.

Keep the official Antigravity CLI distinct from its Python SDK and from third-party projects named antigravity-cli. SDK support for local OpenAI-compatible models, if used, would not by itself validate the official CLI harness.
