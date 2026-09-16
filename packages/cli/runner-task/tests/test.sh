#!/bin/sh
set -eu
mkdir -p /logs/verifier
python3 - <<'PY'
from pathlib import Path
passed = Path('/app/hello.txt').exists() and Path('/app/hello.txt').read_text() == 'hello from heval\n'
Path('/logs/verifier/reward.txt').write_text('1' if passed else '0')
PY
