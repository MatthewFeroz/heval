#!/usr/bin/env bash
# Live status for a running Harbor job. Read-only - safe to run at any time,
# including while the run is in flight.
#
#   ./harbor/status.sh                 # print once
#   ./harbor/status.sh --tasks         # also list completed tasks
#   ./harbor/status.sh --html          # rebuild the HTML report and open it
#   ./harbor/status.sh --watch         # redraw every 60s until the run ends
#   ./harbor/status.sh --watch 30      # ...every 30s
#   ./harbor/status.sh --watch --notify  # + macOS notification on failure/finish
#   ./harbor/status.sh <job-dir>       # a different job
set -uo pipefail
cd "$(dirname "$0")/.."

JOB="jobs/terminal-bench-composio-mirror"
TASKS=0; HTML=0; WATCH=0; INTERVAL=60; NOTIFY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --tasks)  TASKS=1 ;;
    --html)   HTML=1 ;;
    --notify) NOTIFY=1 ;;
    --watch)  WATCH=1
              # optional numeric interval as the next arg
              if [[ "${2:-}" =~ ^[0-9]+$ ]]; then INTERVAL="$2"; shift; fi ;;
    *)        JOB="${1%/}" ;;
  esac
  shift
done
[ -d "$JOB" ] || { echo "no such job dir: $JOB" >&2; exit 1; }

NAME=$(basename "$JOB")
CFG="harbor/jobs/$NAME.yaml"
OUT=/tmp/heval-status-report

# Total trials expected = agents x tasks x attempts, read from the job config so
# this stays correct if the config changes.
read -r TOTAL NTASKS <<<"$(bun -e '
const {parse} = require("yaml"); const fs = require("fs");
const p = process.argv[1];
if (!fs.existsSync(p)) { console.log("0 0"); process.exit(0) }
const c = parse(fs.readFileSync(p, "utf8"));
const agents = (c.agents ?? []).length;
const tasks = (c.datasets ?? []).reduce((n, d) => n + (d.task_names ?? []).length, 0);
console.log(agents * tasks * (c.n_attempts ?? 1), tasks);
' "$CFG" 2>/dev/null || echo "0 0")"

notify() {  # notify <title> <message>
  [ "$NOTIFY" = "1" ] || return 0
  osascript -e "display notification \"$2\" with title \"$1\" sound name \"Submarine\"" >/dev/null 2>&1
}

job_state() {
  if pgrep -fl "harbor run" 2>/dev/null | grep -q "$NAME"; then
    echo running
  elif [ "$1" -ge "$TOTAL" ] && [ "$TOTAL" -gt 0 ]; then
    echo complete
  else
    echo dead
  fi
}

render() {
  local done running start elapsed state
  done=$(ls "$JOB"/*__*/result.json 2>/dev/null | wc -l | tr -d ' ')
  running=$(docker ps -q 2>/dev/null | wc -l | tr -d ' ')
  start=$(stat -f %B "$JOB")
  elapsed=$(( ($(date +%s) - start) / 60 ))
  state=$(job_state "$done")

  case "$state" in
    running)  printf 'job      %s\nstate    running\n' "$JOB" ;;
    complete) printf 'job      %s\nstate    COMPLETE\n' "$JOB" ;;
    dead)     printf 'job      %s\nstate    NOT RUNNING (stopped early)\n' "$JOB" ;;
  esac
  printf 'progress %s/%s trials   %sm elapsed   %s containers busy\n' \
    "$done" "$TOTAL" "$elapsed" "$running"
  [ "$done" -gt 0 ] && [ "$elapsed" -gt 0 ] && python3 -c "
d=$done; t=$TOTAL; el=$elapsed
pace = d/(el/60)
rem = (t-d)/pace if pace and t>d else 0
print(f'pace     {pace:.1f} trials/hr -> {rem:.1f}h remaining' if rem else f'pace     {pace:.1f} trials/hr')
"
  echo
  echo "failures by type:"
  if grep -qho '"exception_type": "[^"]*"' "$JOB"/*__*/result.json 2>/dev/null; then
    grep -ho '"exception_type": "[^"]*"' "$JOB"/*__*/result.json 2>/dev/null \
      | sed 's/.*: "//; s/"//' | sort | uniq -c | sed 's/^/  /'
  else
    echo "  none"
  fi

  [ "$done" -gt 0 ] || return 0
  bun harbor/report/build-report.ts "$JOB" --out "$OUT" >/dev/null 2>&1
  echo
  TASKS_FLAG=$TASKS NTASKS=$NTASKS python3 - "$OUT/$NAME.json" <<'PY'
import json, sys, os, collections
rows = json.load(open(sys.argv[1]))["rows"]
g = collections.defaultdict(list)
for r in rows:
    g[(r["modelShort"], r["vendor"])].append(r)

print(f"{'model':22s} {'vendor':10s} {'n':>2s} {'pass':>7s} {'cost':>9s} {'$/trial':>9s} {'med_s':>6s} {'TO':>3s}")
print("-" * 76)
for (m, v), rs in sorted(g.items(), key=lambda kv: -sum(x["passed"] for x in kv[1]) / len(kv[1])):
    n = len(rs)
    p = sum(x["passed"] for x in rs)
    c = sum(x["costUsd"] or 0 for x in rs)
    secs = sorted(x["agentSeconds"] for x in rs if x.get("agentSeconds") is not None)
    med = secs[len(secs) // 2] if secs else 0
    to = sum(1 for x in rs if x.get("error") == "AgentTimeoutError")
    print(f"{m:22s} {v:10s} {n:2d} {p:3d}/{n:<3d} ${c:8.4f} ${c/n:8.4f} {med:6.0f} {to:3d}")

tot = sum(r["costUsd"] or 0 for r in rows)
counts = collections.Counter(r["task"] for r in rows)
nmodels = len(g)
ntasks = int(os.environ.get("NTASKS") or 0) or len(counts)
done = sorted(t for t, c in counts.items() if c == nmodels)
print(f"\ntotal ${tot:.2f} over {len(rows)} trials | {len(done)}/{ntasks} tasks complete across all {nmodels} models")

if os.environ.get("TASKS_FLAG") == "1" and done:
    print("\ncompleted tasks:")
    for t in done:
        rs = [r for r in rows if r["task"] == t]
        who = ",".join(sorted(x["modelShort"] for x in rs if x["passed"])) or "-none-"
        print(f"  {t[:36]:38s} {sum(x['passed'] for x in rs)}/{nmodels}  {who}")
PY
}

if [ "$WATCH" = "0" ]; then
  render
  if [ "$HTML" = "1" ]; then
    echo; echo "opening $OUT/$NAME.html"; open "$OUT/$NAME.html"
  fi
  exit 0
fi

# --watch: redraw until the job stops running. Notify only on transitions, so a
# quiet run stays quiet and you are not pinged once per refresh.
echo "watching $JOB every ${INTERVAL}s - ctrl-c to stop"
prev_fail=-1
while :; do
  done=$(ls "$JOB"/*__*/result.json 2>/dev/null | wc -l | tr -d ' ')
  state=$(job_state "$done")
  fails=$(grep -ho '"exception_type"' "$JOB"/*__*/result.json 2>/dev/null | wc -l | tr -d ' ')

  clear
  printf 'last refresh %s\n\n' "$(date '+%H:%M:%S')"
  render

  if [ "$prev_fail" -ge 0 ] && [ "$fails" -gt "$prev_fail" ]; then
    notify "heval: new failure" "$((fails - prev_fail)) new failure(s), $done/$TOTAL trials done"
  fi
  prev_fail=$fails

  if [ "$state" = "complete" ]; then
    notify "heval: run complete" "$done/$TOTAL trials finished"
    echo; echo "run complete."
    exit 0
  fi
  if [ "$state" = "dead" ]; then
    notify "heval: run STOPPED" "died at $done/$TOTAL trials"
    echo; echo "run stopped early at $done/$TOTAL."
    exit 1
  fi
  sleep "$INTERVAL"
done
