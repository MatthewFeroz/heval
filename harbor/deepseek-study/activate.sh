# Source from any directory. No user configuration or credentials are replaced.
HEVAL_STUDY_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
export PATH="$HEVAL_STUDY_ROOT/.tools/deepseek-study/bin:$HEVAL_STUDY_ROOT/.tools/deepseek-study/node_modules/.bin:$HOME/.local/bin:$PATH"
for heval_cli in claude-code codex opencode-ai pi-coding-agent; do
  if [[ -d "$HEVAL_STUDY_ROOT/.tools/deepseek-study/$heval_cli/node_modules/.bin" ]]; then
    export PATH="$HEVAL_STUDY_ROOT/.tools/deepseek-study/$heval_cli/node_modules/.bin:$PATH"
  fi
done
unset heval_cli
