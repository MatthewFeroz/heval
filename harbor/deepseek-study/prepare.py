#!/usr/bin/env python3
"""Generate a secret-free two-agent pilot; never starts an evaluation."""
import argparse
import json
from pathlib import Path
from urllib.parse import urlparse

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--include-pi', action='store_true', help='Include Pi through the Merge Chat Completions endpoint')
parser.add_argument('--vendor', required=True, help='Vendor verified in the authenticated Merge catalog')
parser.add_argument('--proxy-url', required=True, help='Container-reachable proxy origin, e.g. http://172.17.0.1:8787')
parser.add_argument('--task', required=True, help='Local Harbor task directory (instruction.md + task.toml)')
parser.add_argument('--output', default='harbor/deepseek-study/local/pilot.json')
args = parser.parse_args()
url = urlparse(args.proxy_url)
if url.scheme not in ('http', 'https') or not url.hostname or url.username or url.password or url.query or url.fragment or url.path not in ('', '/'):
    parser.error('--proxy-url must be an http(s) origin without credentials, path, query, or fragment')
task = Path(args.task).resolve()
if not all((task / name).is_file() for name in ('instruction.md', 'task.toml')):
    parser.error('--task must contain instruction.md and task.toml')
model = 'deepseek/deepseek-v4.1-flash'
base = args.proxy_url.rstrip('/')
agent_base = dict(model_name=model, override_timeout_sec=900)
agents = [
    dict(agent_base, name='codex', env={'OPENAI_BASE_URL': base+'/v1/openai', 'HEVAL_VENDOR': args.vendor}, kwargs={
        'version': '0.154.0',
        'config': {'model_provider': 'merge', 'model_providers': {'merge': {
            'name': 'Merge Gateway', 'base_url': base+'/v1/openai', 'env_key': 'OPENAI_API_KEY',
            'wire_api': 'responses', 'supports_websockets': False,
        }}},
    }),
    dict(agent_base, name='claude-code', env={'ANTHROPIC_BASE_URL': base+'/v1/anthropic', 'HEVAL_VENDOR': args.vendor}, kwargs={'version': '2.1.270'}),
]
if args.include_pi:
    agents.append(dict(agent_base, name='pi',
        env={'DEEPSEEK_BASE_URL': base+'/v1/openai', 'HEVAL_VENDOR': args.vendor},
        kwargs={'version': '0.85.1', 'model_api': 'openai-completions'}))
job = dict(job_name='deepseek-v41-protocol-pilot', n_attempts=1, n_concurrent_trials=1,
           environment=dict(type='docker', delete=True, cpu_enforcement_policy='limit', memory_enforcement_policy='limit'),
           agents=agents, tasks=[dict(path=str(task))])
output = Path(args.output)
output.parent.mkdir(parents=True, exist_ok=True)
if output.exists():
    parser.error(f'{output} already exists; choose a new --output')
output.write_text(json.dumps(job, indent=2)+'\n')
print(output)
print('Pilot only: defaults are not normalized reasoning budgets. Verify routing and tool round trips before the study.')
