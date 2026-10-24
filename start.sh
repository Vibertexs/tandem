#!/usr/bin/env bash
# Starts Tandem with one command, then opens the page. macOS and Linux (also Git Bash on Windows;
# on Windows, start.ps1 is the tested path).
#
# Host a team on this computer:
#   ./start.sh                  brain + page + manager + 2 workers (each task is a real Claude run)
#   ./start.sh --simulate       workers fake the coding (no Claude calls for the work)
#   ./start.sh --lan            also let other computers on your network join
#   ./start.sh --fresh          wipe the team's database first
#   ./start.sh --push           push task and goal branches to the repo's origin
#   ./start.sh --model auto     real workers pick the model by task difficulty
# Join someone else's team:
#   ./start.sh --join ws://192.168.1.20:3001 --db tandem-local
# More: --workers N  --repo PATH  --no-manager  --no-browser  --manager-model M  --budget USD
# Stop: ./stop.sh   (--all also stops the brain)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
DB=tandem-local JOIN="" REPO="" WORKERS=2 SIM=0 NOMGR=0 LAN=0 FRESH=0 PUSH=0 NOBROWSER=0
MODEL=haiku MGRMODEL=haiku BUDGET=0.50
while [ $# -gt 0 ]; do
  case "$1" in
    --db) DB="$2"; shift ;; --join) JOIN="$2"; shift ;; --repo) REPO="$2"; shift ;;
    --workers) WORKERS="$2"; shift ;; --model) MODEL="$2"; shift ;; --manager-model) MGRMODEL="$2"; shift ;;
    --budget) BUDGET="$2"; shift ;; --simulate) SIM=1 ;; --no-manager) NOMGR=1 ;; --lan) LAN=1 ;;
    --fresh) FRESH=1 ;; --push) PUSH=1 ;; --no-browser) NOBROWSER=1 ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "unknown option: $1 (see ./start.sh --help)"; exit 2 ;;
  esac
  shift
done
STATE="$ROOT/.tandem"; LOGS="$STATE/logs"; PIDS="$STATE/pids.txt"
mkdir -p "$LOGS"; touch "$PIDS"
HOSTING=1; [ -n "$JOIN" ] && HOSTING=0
step() { printf '\n== %s\n' "$1"; }
up() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
# a name from an earlier run that is still alive
running() { while read -r n p; do [ "$n" = "$1" ] && kill -0 "$p" 2>/dev/null && return 0; done < "$PIDS"; return 1; }
# start a background process that logs to .tandem/logs and does not hold this terminal
spawn() { local name="$1" log="$2" dir="$3" pid; shift 3
  pushd "$dir" >/dev/null
  nohup "$@" >"$LOGS/$log.log" 2>"$LOGS/$log.err" </dev/null &
  pid=$!; disown "$pid" 2>/dev/null || true
  popd >/dev/null
  echo "$name $pid" >> "$PIDS"; }
fileurl() { node -e 'console.log(require("url").pathToFileURL(process.argv[1]).href)' "$1"; }

# the SpacetimeDB installer puts the CLI here on Windows
if ! command -v spacetime >/dev/null 2>&1 && [ -n "${LOCALAPPDATA:-}" ] && [ -x "$LOCALAPPDATA/SpacetimeDB/spacetime.exe" ]; then
  PATH="$PATH:$(cd "$LOCALAPPDATA/SpacetimeDB" && pwd)"
fi
need="node npm git"; [ $HOSTING = 1 ] && need="$need spacetime"
if { [ $SIM = 0 ] && [ "$WORKERS" -gt 0 ]; } || { [ $HOSTING = 1 ] && [ $NOMGR = 0 ]; }; then need="$need claude"; fi
for t in $need; do command -v "$t" >/dev/null 2>&1 || { echo "$t is not installed or not on PATH. See README.md (Quick start)."; exit 1; }; done

step 'Installing packages (first run only)'
for d in brain/spacetimedb brain mcp dashboard launcher manager; do
  [ -d "$ROOT/$d/node_modules" ] || { echo "  npm install in $d"; (cd "$ROOT/$d" && npm install --silent --no-fund --no-audit); }
done

if [ $HOSTING = 1 ]; then
  step 'Brain (SpacetimeDB)'
  LISTEN=127.0.0.1:3001; [ $LAN = 1 ] && LISTEN=0.0.0.0:3001
  if ! up 3001; then
    spawn brain brain "$ROOT" spacetime start --listen-addr "$LISTEN"
    for _ in $(seq 40); do up 3001 && break; sleep 0.5; done
    up 3001 || { echo 'The brain did not start. See .tandem/logs/brain.err'; exit 1; }
    echo "  started on $LISTEN"
  else echo '  already running'; fi
  spacetime server add dev3001 --url http://127.0.0.1:3001 --no-fingerprint >/dev/null 2>&1 || true
  extra=""; [ $FRESH = 1 ] && extra="--delete-data=always"
  if ! out=$(spacetime publish "$DB" --server dev3001 --no-config --module-path "$ROOT/brain/spacetimedb" --yes $extra 2>&1); then
    echo "$out"; echo "Publishing $DB failed. If the schema changed, try ./start.sh --fresh (this wipes $DB)."; exit 1
  fi
  echo "  team '$DB' is ready"
  URI=ws://127.0.0.1:3001
else
  URI="$JOIN"; step "Joining $DB at $URI"
fi

step 'The page (http://localhost:5173)'
if ! up 5173; then
  spawn page page "$ROOT/dashboard" npx vite --port 5173 --strictPort
  for _ in $(seq 40); do up 5173 && break; sleep 0.5; done
  echo '  started'
else echo '  already running'; fi
URL="http://localhost:5173/?db=$DB"; [ $HOSTING = 0 ] && URL="$URL&uri=$(node -e 'console.log(encodeURIComponent(process.argv[1]))' "$URI")"

[ -n "$REPO" ] || REPO="$(dirname "$ROOT")/tandem-playground"
if [ ! -d "$REPO/.git" ]; then
  step "Creating a playground repo for the workers: $REPO"
  mkdir -p "$REPO"; git -C "$REPO" init -q
  echo '# Tandem playground' > "$REPO/README.md"; echo '.worktrees/' > "$REPO/.gitignore"
  git -C "$REPO" add -A; git -C "$REPO" -c user.name=tandem -c user.email=tandem@localhost commit -q -m Start
fi

export STDB_URI="$URI" STDB_DB="$DB" TANDEM_SESSION=live
if [ $HOSTING = 1 ] && [ $NOMGR = 0 ]; then
  step 'Manager (plans every goal you type)'
  if running manager; then echo '  already running'; else
    pushflag=""; [ $PUSH = 1 ] && pushflag=--push
    TANDEM_TOKEN_FILE="$ROOT/mcp/.tandem/manager-token-$DB" spawn manager manager "$ROOT" \
      node --import "$(fileurl "$ROOT/manager/node_modules/tsx/dist/esm/index.mjs")" "$ROOT/manager/watch.ts" \
      --repo "$REPO" --model "$MGRMODEL" --budget "$BUDGET" $pushflag
    echo '  started. The first time, the page asks you to approve "Manager Claude".'
  fi
fi

if [ "$WORKERS" -gt 0 ]; then
  step "$WORKERS worker(s)$([ $SIM = 1 ] && echo ' (simulated: no Claude calls)')"
  names=(Alex Sam Jordan Taylor Riley Casey); offset=0; suffix=""
  [ $HOSTING = 0 ] && { offset=3; suffix="-$(hostname | tr '[:upper:]' '[:lower:]')"; }
  for i in $(seq 0 $((WORKERS - 1))); do
    name="${names[$(( (i + offset) % 6 ))]}$suffix"
    if running "worker-$name"; then echo "  $name (already running)"; continue; fi
    flags=(); [ $SIM = 1 ] && flags+=(--simulate --sim-ms 3000); [ $PUSH = 1 ] && flags+=(--push)
    if [ "$MODEL" = auto ]; then unset LAUNCHER_MODEL; else export LAUNCHER_MODEL="$MODEL"; fi
    LAUNCHER_BUDGET_USD="$BUDGET" TANDEM_TOKEN_FILE="$ROOT/mcp/.tandem/worker-$name-$DB" spawn "worker-$name" "worker-$name" "$ROOT" \
      node --import "$(fileurl "$ROOT/launcher/node_modules/tsx/dist/esm/index.mjs")" "$ROOT/launcher/launcher.ts" \
      --name "$name" --repo "$REPO" "${flags[@]}"
    echo "  $name"
  done
fi

step 'Ready'
echo "  Open $URL"
[ $HOSTING = 1 ] && echo '  First time: click "Make me the owner", then approve "Manager Claude". Then describe what you want built.'
echo '  Logs: .tandem/logs   Stop: ./stop.sh'
if [ $NOBROWSER = 0 ]; then
  { command -v open >/dev/null && open "$URL"; } || { command -v xdg-open >/dev/null && xdg-open "$URL"; } || { command -v cmd.exe >/dev/null && cmd.exe /c start "" "$URL"; } || true
fi
