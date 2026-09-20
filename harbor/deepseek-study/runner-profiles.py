#!/usr/bin/env python3
"""Split a generated pilot into one-agent connected-runner profiles. No execution."""
import argparse
import json
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--pilot', required=True)
parser.add_argument('--env-file', required=True, help='Existing private credential file on worker')
parser.add_argument('--output-dir', required=True, help='New directory; existing directories are never overwritten')
args = parser.parse_args()
pilot = json.loads(Path(args.pilot).read_text())
secret = Path(args.env_file).resolve()
if not secret.is_file():
    parser.error('--env-file must exist on this worker')
if secret.stat().st_mode & 0o077:
    parser.error('Restrict the credential file permissions first: chmod 600 FILE')
out = Path(args.output_dir).resolve()
if out.exists():
    parser.error('--output-dir must be new')
agents = pilot.get('agents', [])
if not agents or len(agents) > 3 or any(a.get('name') not in ('codex', 'claude-code', 'pi') for a in agents):
    parser.error('Use a generated Codex/Claude/Pi pilot')
if len({a['name'] for a in agents}) != len(agents):
    parser.error('Duplicate agents are not supported')
tasks = pilot.get('tasks', [])
if not tasks or any(not Path(t['path']).is_absolute() for t in tasks):
    parser.error('Generate the pilot on this worker with prepare.py first')
out.mkdir(parents=True, mode=0o700)
profiles = []
for agent in agents:
    name = agent['name']
    config = {'n_attempts': pilot.get('n_attempts', 1), 'agents': [agent], 'tasks': tasks}
    (out / f'{name}.json').write_text(json.dumps(config, indent=2)+'\n')
    profiles.append({'id': f'deepseek-{name}', 'title': f'DeepSeek V4.1 Flash / {name}',
        'benchmark': 'DeepSeek protocol pilot (not a capability score)', 'config': f'{name}.json',
        'envFile': str(secret), 'timeoutSeconds': 1800})
(out / 'profiles.json').write_text(json.dumps({'schemaVersion': 1, 'profiles': profiles}, indent=2)+'\n')
print(out / 'profiles.json')
print('Use this registry with runner start --profiles PATH. Credentials were not read or copied.')
