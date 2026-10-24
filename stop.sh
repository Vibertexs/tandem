#!/usr/bin/env bash
# Stops what start.sh started.   ./stop.sh   (--all also stops the brain)
set -uo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
PIDS="$ROOT/.tandem/pids.txt"
[ -f "$PIDS" ] || { echo 'Nothing to stop (no .tandem/pids.txt).'; exit 0; }
keep=""
while read -r name pid; do
  [ -n "$name" ] || continue
  if [ "$name" = brain ] && [ "${1:-}" != --all ]; then keep="$keep$name $pid"$'\n'; continue; fi
  if kill -0 "$pid" 2>/dev/null; then
    pkill -P "$pid" 2>/dev/null || true   # its children (vite, the Claude runs)
    kill "$pid" 2>/dev/null || true
    echo "stopped $name"
  fi
done < "$PIDS"
printf '%s' "$keep" > "$PIDS"
[ -s "$PIDS" ] || rm -f "$PIDS"
