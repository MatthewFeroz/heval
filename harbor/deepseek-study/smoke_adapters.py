"""Small installed-agent adapters for protocol smoke tests, not scored studies.

Native output is retained; token accounting and ATIF conversion are not implemented.
Every agent gets its own disposable Harbor task container and home directory.
"""
import json
import shlex

from harbor.agents.installed.base import BaseInstalledAgent, with_prompt_template

BASE_URL = "http://host.docker.internal:18787/v1/openai"
MODEL = "deepseek/deepseek-v4.1-flash"


class SmokeAgent(BaseInstalledAgent):
    async def write_text(self, environment, path, text):
        await self.exec_as_agent(
            environment,
            command=f"mkdir -p $(dirname {shlex.quote(path)}) && printf %s {shlex.quote(text)} > {shlex.quote(path)}",
        )

    def key_env(self):
        key = self._get_env("OPENAI_API_KEY")
        if not key:
            raise ValueError("The smoke test requires the worker's Merge OPENAI_API_KEY")
        return {"MERGE_API_KEY": key}

    async def execute(self, environment, command, env):
        await self.exec_as_agent(
            environment,
            command=f"{command} > /logs/agent/native.log 2>&1",
            env=env,
        )


class DeepSeekHarness(SmokeAgent):
    def __init__(self, *args, thinking=None, **kwargs):
        self.smoke_thinking = thinking
        super().__init__(*args, **kwargs)

    @staticmethod
    def name():
        return "deepseek-harness"

    async def install(self, environment):
        await self.ensure_system_dependencies(environment, ("python3",))
        # Pin the Linux ARM64 runtime and verify its official release checksum.
        # npm runs native dependency installers; retain the resolved lockfile.
        await self.exec_as_agent(environment, command=(
            "set -eu; mkdir -p /opt/heval-node; "
            "python3 -c 'import urllib.request; urllib.request.urlretrieve(\"https://nodejs.org/dist/v22.23.2/node-v22.23.2-linux-arm64.tar.gz\", \"/tmp/heval-node.tar.gz\")'; "
            "echo '013b59cfd2819703a6f4a14ab891fc46fc2a4e3f5bcd92de3fb4929b43e35b30  /tmp/heval-node.tar.gz' | sha256sum -c -; "
            "tar -xzf /tmp/heval-node.tar.gz -C /opt/heval-node --strip-components=1; "
            "export PATH=/opt/heval-node/bin:$PATH; "
            "mkdir -p /opt/heval-dsh && "
            f"npm install --prefix /opt/heval-dsh @deepseek-ai/dsh@{shlex.quote(self._version)} && "
            "cp /opt/heval-dsh/package-lock.json /logs/agent/package-lock.json && "
            "/opt/heval-dsh/node_modules/.bin/dsh --version > /logs/agent/version.txt"
        ))

    @with_prompt_template
    async def run(self, instruction, environment, context):
        settings = {
            "agent-default-model": {"provider": "deepseek-official", "model": MODEL},
            "llm-deepseek": {"apiKeyEnv": "MERGE_API_KEY", "baseURL": BASE_URL, "maxTokens": 16384},
            "permission": {"defaultPreset": "danger-full-access"},
        }
        if self.smoke_thinking is not None:
            settings["llm-deepseek"]["thinking"] = self.smoke_thinking
        # JSON is valid YAML and avoids an extra serialization dependency.
        await self.write_text(environment, "/tmp/heval-dsh/settings.yaml", json.dumps(settings))
        env = self.key_env() | {"DSH_HOME": "/tmp/heval-dsh", "DSH_PERMISSION_MODE": "danger-full-access", "DSH_TELEMETRY_DISABLED": "1"}
        await self.execute(environment,
            'export PATH=/opt/heval-node/bin:$PATH; /opt/heval-dsh/node_modules/.bin/dsh --profile headless ' + shlex.quote(instruction), env)


class DeepAgents(SmokeAgent):
    @staticmethod
    def name():
        return "deep-agents"

    async def install(self, environment):
        await self.ensure_system_dependencies(environment, ("curl", "git"))
        await self.exec_as_agent(environment, command=(
            "set -eu; curl -LsSf https://astral.sh/uv/0.8.22/install.sh | sh; "
            f"$HOME/.local/bin/uv tool install --python 3.12 deepagents-code=={shlex.quote(self._version)}; "
            "$HOME/.local/bin/dcode --version > /logs/agent/version.txt; "
            "$HOME/.local/bin/uv pip freeze --python $HOME/.local/share/uv/tools/deepagents-code/bin/python > /logs/agent/python.freeze.txt"
        ))

    @with_prompt_template
    async def run(self, instruction, environment, context):
        config = '[models.providers.openai]\napi_key_env = "MERGE_API_KEY"\nbase_url = ' + json.dumps(BASE_URL) + '\nmodels = [' + json.dumps(MODEL) + ']\n'
        await self.exec_as_agent(environment, command="mkdir -p $HOME/.deepagents")
        await self.exec_as_agent(environment, command="printf %s " + shlex.quote(config) + " > $HOME/.deepagents/config.toml")
        await self.execute(environment,
            '$HOME/.local/bin/dcode --model ' + shlex.quote("openai:" + MODEL) + ' --shell-allow-list all --no-mcp --non-interactive ' + shlex.quote(instruction),
            self.key_env() | {"LANGSMITH_TRACING": "false"})


class FactoryDroid(SmokeAgent):
    @staticmethod
    def name():
        return "factory-droid"

    async def install(self, environment):
        await self.ensure_system_dependencies(environment, ("curl",))
        url = f"https://downloads.factory.ai/factory-cli/releases/{self._version}/linux/arm64/droid"
        await self.exec_as_agent(environment, command=(
            f"set -eu; mkdir -p /opt/heval-factory; cd /opt/heval-factory; curl -fLsS {shlex.quote(url)} -o droid; "
            f"curl -fLsS {shlex.quote(url + '.sha256')} -o droid.sha256; "
            "printf '%s  droid\n' \"$(awk '{print $1}' droid.sha256)\" | sha256sum -c -; "
            "chmod +x droid; ./droid --version > /logs/agent/version.txt"
        ))

    @with_prompt_template
    async def run(self, instruction, environment, context):
        config = {"customModels": [{"model": MODEL, "displayName": "Merge DeepSeek", "baseUrl": BASE_URL, "apiKey": "${MERGE_API_KEY}", "provider": "generic-chat-completion-api", "maxOutputTokens": 16384}]}
        await self.exec_as_agent(environment, command="mkdir -p $HOME/.factory && printf %s " + shlex.quote(json.dumps(config)) + " > $HOME/.factory/settings.json")
        await self.write_text(environment, "/tmp/heval-instruction.txt", instruction)
        # Factory credentials are distinct. Never send a Merge credential to its auth API.
        env = self.key_env()
        if key := self._get_env("FACTORY_API_KEY"):
            env["FACTORY_API_KEY"] = key
        await self.execute(environment, "/opt/heval-factory/droid exec --model custom:Merge-DeepSeek-0 --skip-permissions-unsafe --output-format json --cwd /app --file /tmp/heval-instruction.txt", env)
