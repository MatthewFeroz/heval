"""Heval's pinned Deep Agents Code adapter.

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
