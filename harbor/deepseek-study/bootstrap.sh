#!/usr/bin/env bash
# Portable core installation. Run with bash; requires uv, npm, Node and Bun.
set -euo pipefail
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$root"
for tool in uv npm node bun; do command -v "$tool" >/dev/null || { echo "Install $tool first" >&2; exit 1; }; done
python3 - <<'PY'
import shutil
if shutil.disk_usage('.').free < 5 * 1024**3:
    raise SystemExit('At least 5 GiB free is required to install the toolchain. Reserve 50+ GiB for benchmark images/results.')
PY
uv tool install --python 3.12 --with-requirements harbor/deepseek-study/harbor-python.freeze.txt harbor==0.23.0
uv tool install --python 3.12 --with-requirements harbor/deepseek-study/deepagents-python.freeze.txt deepagents-code==0.1.70
mkdir -p .tools/deepseek-study
cp harbor/deepseek-study/package{,-lock}.json .tools/deepseek-study/
npm ci --prefix .tools/deepseek-study
# Each prefix isolates conflicting package dependencies and native executables.
for spec in '@anthropic-ai/claude-code@2.1.270' '@openai/codex@0.154.0' 'opencode-ai@1.18.30' '@earendil-works/pi-coding-agent@0.85.1'; do
    name="${spec##*/}"
    name="${name%@*}"
    npm install --prefix ".tools/deepseek-study/$name" --save-exact "$spec"
done
cat <<'MSG'
Core installed. Source harbor/deepseek-study/activate.sh.
Grok, Cursor and Antigravity use native vendor distributions: see README.md.
Before launching, inspect npm install-script warnings and test native tools inside
an isolated Harbor task. Do not assume `--version` validates subprocess tools.
MSG
