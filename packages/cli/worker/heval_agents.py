"""Heval's pinned Deep Agents Code and Factory Droid adapters.

Native output and dependency versions are retained locally. Token/cost and ATIF
trajectory conversion are not implemented; those measurements remain unknown.
"""
import json
import shlex
from harbor.agents.installed.base import BaseInstalledAgent, with_prompt_template


class DeepAgents(BaseInstalledAgent):
    @staticmethod
    def name():
        return "deep-agents"

    def get_version_command(self):
        return "$HOME/.local/bin/dcode --version"

    async def install(self, environment):
        await self.ensure_system_dependencies(environment, ("curl", "git"))
        await self.exec_as_agent(environment, command=(
            "set -eu; curl -LsSf https://astral.sh/uv/0.12.18/install.sh | sh; "
            f"$HOME/.local/bin/uv tool install --python 3.12 deepagents-code=={shlex.quote(self._version)}; "
            "$HOME/.local/bin/dcode --version > /logs/agent/version.txt; "
            "$HOME/.local/bin/uv pip freeze --python $HOME/.local/share/uv/tools/deepagents-code/bin/python > /logs/agent/python.freeze.txt"
        ))

    @with_prompt_template
    async def run(self, instruction, environment, context):
        key = self._get_env("OPENAI_API_KEY")
        endpoint = self._get_env("OPENAI_BASE_URL")
        if not key or endpoint != "https://api-gateway.merge.dev/v1/openai":
            raise ValueError("Deep Agents needs the approved Merge connection")
        config = '[models.providers.openai]\napi_key_env = "OPENAI_API_KEY"\nbase_url = ' + json.dumps(endpoint) + '\nmodels = [' + json.dumps(self.model_name) + ']\n'
        await self.exec_as_agent(environment, command="mkdir -p $HOME/.deepagents && printf %s " + shlex.quote(config) + " > $HOME/.deepagents/config.toml")
        result = await self.exec_as_agent(environment,
            command='$HOME/.local/bin/dcode --model ' + shlex.quote("openai:" + self.model_name) + ' --shell-allow-list all --no-mcp --non-interactive ' + shlex.quote(instruction) + ' > /logs/agent/native.log 2>&1',
            env={"OPENAI_API_KEY": key, "LANGSMITH_TRACING": "false"})
        if result.return_code != 0:
            raise RuntimeError("Deep Agents exited unsuccessfully; inspect its local native log")


class FactoryDroid(BaseInstalledAgent):
    """Droid's BYOK custom model routes every model call to Merge Gateway; no Factory login is used."""

    @staticmethod
    def name():
        return "factory-droid"

    def get_version_command(self):
        return 'if [ -s ~/.nvm/nvm.sh ]; then . ~/.nvm/nvm.sh; fi; droid --version'

    async def install(self, environment):
        await self.ensure_system_dependencies(environment, ("curl", "bash", "nodejs", "npm"))
        package = "droid@" + self._version
        await self.exec_as_agent(environment, command=(
            "set -euo pipefail; "
            "if ldd --version 2>&1 | grep -qi musl || [ -f /etc/alpine-release ]; then"
            f"  npm install -g {shlex.quote(package)};"
            " else"
            "  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.2/install.sh | bash &&"
            '  export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" &&'
            "  nvm install 22 && nvm alias default 22 &&"
            f"  npm install -g {shlex.quote(package)};"
            " fi && droid --version > /logs/agent/version.txt"
        ), env={"NVM_NODEJS_ORG_MIRROR": "https://nodejs.org/dist"})

    @with_prompt_template
    async def run(self, instruction, environment, context):
        key = self._get_env("OPENAI_API_KEY")
        endpoint = self._get_env("OPENAI_BASE_URL")
        if not key or endpoint != "https://api-gateway.merge.dev/v1/openai":
            raise ValueError("Factory Droid needs the approved Merge connection")
        # Droid resolves ${OPENAI_API_KEY} at launch, so the key is never written to disk.
        settings = {"customModels": [{"model": self.model_name, "displayName": "Merge Gateway", "baseUrl": endpoint,
            "apiKey": "${OPENAI_API_KEY}", "provider": "openai", "maxOutputTokens": 16384}]}
        await self.exec_as_agent(environment, command="mkdir -p $HOME/.factory && printf %s " + shlex.quote(json.dumps(settings)) + " > $HOME/.factory/settings.json")
        result = await self.exec_as_agent(environment,
            command='if [ -s ~/.nvm/nvm.sh ]; then . ~/.nvm/nvm.sh; fi; droid exec --skip-permissions-unsafe --model custom:Merge-Gateway-0 --output-format stream-json ' + shlex.quote(instruction) + ' > /logs/agent/droid.jsonl 2> /logs/agent/native.log',
            env={"OPENAI_API_KEY": key, "DROID_DISABLE_AUTO_UPDATE": "true", "FACTORY_DROID_AUTO_UPDATE_ENABLED": "false"})
        if result.return_code != 0:
            raise RuntimeError("Factory Droid exited unsuccessfully; inspect its local native log")
