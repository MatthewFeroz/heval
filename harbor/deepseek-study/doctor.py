#!/usr/bin/env python3
"""Read-only local inventory; never reads credentials or calls model APIs."""
import json
import platform
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path

root = Path(__file__).resolve().parents[2]
checks = {}
for name, command in {
    'bun': ['bun', '--version'], 'node': ['node', '--version'],
    'harbor': ['harbor', '--version'], 'docker': ['docker', 'info', '--format', '{{.ServerVersion}}'],
    'claude': ['claude', '--version'], 'codex': ['codex', '--version'],
    'opencode': ['opencode', '--version'], 'pi': ['pi', '--version'],
    'grok': ['grok', '--version'], 'antigravity': ['agy', '--version'],
    'cursor': ['cursor-agent', '--version'], 'deep-agents': ['deepagents-code', '--version'],
    'deepseek': ['dsh', '--version'],
}.items():
    try:
        proc = subprocess.run(command, capture_output=True, text=True, timeout=20)
        checks[name] = {'ok': proc.returncode == 0, 'path': shutil.which(command[0]), 'version': proc.stdout.strip()[:500]}
    except (OSError, subprocess.TimeoutExpired) as exc:
        checks[name] = {'ok': False, 'error': type(exc).__name__}
free = shutil.disk_usage(root).free / 1024**3
result = dict(timestamp=datetime.now(timezone.utc).isoformat(), architecture=platform.machine(),
              free_disk_gib=round(free, 2), checks=checks,
              ready_for_local_benchmarks=checks['docker']['ok'] and free >= 30,
              note='Version checks do not establish provider, native tool, or Harbor adapter compatibility. 30 GiB free is a conservative preflight threshold, not a benchmark guarantee.')
print(json.dumps(result, indent=2))
