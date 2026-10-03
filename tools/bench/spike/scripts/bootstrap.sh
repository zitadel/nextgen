#!/usr/bin/env bash
# Build the server from this worktree, start it detached on SQLite with quiet
# logs and no embedded UI, create a project + user + password, prove one login
# journey by hand, and write the env file the k6 scripts read.
#
#   scripts/bootstrap.sh [--port 8099]
#
# Everything lands under tools/bench/out/ (gitignored).
set -euo pipefail

PORT=8099
while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) PORT="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # tools/bench/spike
ROOT="$(cd "$HERE/../../.." && pwd)"                      # repository root
mkdir -p "$HERE/../out"
OUT="$(cd "$HERE/../out" && pwd)"                        # normalized: systemd-run needs it
RUN="$OUT/server-$PORT"
BASE="http://localhost:$PORT"
ORIGIN="http://localhost:3000"
EMAIL="spike@bench.local"
PASSWORD='Spike-1095-Pass!'

mkdir -p "$RUN/data"

echo "building server from $ROOT"
( cd "$ROOT" && go build -o "$RUN/nextgen-server" . )

cat > "$RUN/nextgen.yaml" <<YAML
server:
  address: ":$PORT"
  data_dir: ./data
  console_enabled: false
  login_enabled: false
platform:
  bootstrap_project: true
instrumentation:
  log:
    level: warn
    add_source: false
    streams: [runtime, ready]
YAML

if curl -fsS -o /dev/null "$BASE/healthz" 2>/dev/null; then
  echo "a server already answers on $BASE; reusing it"
else
  # A transient user unit survives whatever shell started it; stop it with
  # `systemctl --user stop nextgen-spike-$PORT`. The server's fatal startup
  # errors are logged at INFO, so the first start keeps the default log
  # level to make them visible.
  echo "applying migrations"
  ( cd "$RUN" && ./nextgen-server migrate -c nextgen.yaml > migrate.log 2>&1 ) || { cat "$RUN/migrate.log"; exit 1; }
  echo "starting server as user unit nextgen-spike-$PORT, log at $RUN/server.log"
  systemctl --user stop "nextgen-spike-$PORT" 2>/dev/null || true
  rm -f "$RUN/server.log"
  systemd-run --user --quiet --unit="nextgen-spike-$PORT" --collect \
    -p WorkingDirectory="$RUN" -p StandardOutput="append:$RUN/server.log" -p StandardError="append:$RUN/server.log" \
    "$RUN/nextgen-server" -c nextgen.yaml
  for _ in $(seq 1 60); do
    curl -fsS -o /dev/null "$BASE/healthz" 2>/dev/null && break
    sleep 1
  done
  curl -fsS -o /dev/null "$BASE/healthz" || { echo "server never came up:"; tail -20 "$RUN/server.log"; exit 1; }
fi

echo "creating project"
curl -fsS -X POST "$BASE/projects" -H 'content-type: application/json' \
  -d "{\"name\":\"spike-1095\",\"preview_origins\":[\"$ORIGIN\"],\"seed_defaults\":true}" > "$RUN/project.json"
PROJECT_ID=$(jq -r .id "$RUN/project.json")
PROJECT_SECRET=$(jq -r .project_secret "$RUN/project.json")

echo "creating user"
USER_ID=$(curl -fsS -X POST "$BASE/users?project_id=$PROJECT_ID" \
  -H "Authorization: Bearer $PROJECT_SECRET" -H 'content-type: application/json' \
  -d "{\"schema\":\"https://nextgen.com/api/schemas/default-human-user.json\",\"attributes\":{\"email\":\"$EMAIL\"}}" | jq -r .id)
curl -fsS -o /dev/null -X PUT "$BASE/users/$USER_ID/password?project_id=$PROJECT_ID" \
  -H "Authorization: Bearer $PROJECT_SECRET" -H 'content-type: application/json' \
  -d "{\"password\":\"$PASSWORD\",\"is_change_required\":false}"

echo "proving one login journey by hand"
JAR="$RUN/cookies.txt"; rm -f "$JAR"
FLOW_ID=$(curl -fsS -c "$JAR" -X POST "$BASE/flow" -H 'content-type: application/json' -H "Origin: $ORIGIN" \
  -d "{\"project_id\":\"$PROJECT_ID\",\"purpose\":\"login\"}" | jq -r .id)
STEP=$(curl -fsS -b "$JAR" -c "$JAR" -X POST "$BASE/flow/$FLOW_ID/submit" \
  -H 'content-type: application/json' -H "Origin: $ORIGIN" \
  -d "{\"action\":\"submit\",\"fields\":{\"email\":\"$EMAIL\"}}")
echo "  after identifier: step=$(jq -r .step.name <<<"$STEP") error=$(jq -r .step.error <<<"$STEP")"
FLOW_ID=$(jq -r .id <<<"$STEP")
STEP=$(curl -fsS -b "$JAR" -c "$JAR" -X POST "$BASE/flow/$FLOW_ID/submit" \
  -H 'content-type: application/json' -H "Origin: $ORIGIN" \
  -d "{\"action\":\"submit\",\"fields\":{\"x-auth-methods#password\":\"$PASSWORD\"}}")
echo "  after password:   step=$(jq -r .step.name <<<"$STEP") error=$(jq -r .step.error <<<"$STEP") handoff=$(jq -r '.handoff_token != null' <<<"$STEP")"
[[ "$(jq -r '.handoff_token != null' <<<"$STEP")" == true ]] || { echo "login journey did not hand off" >&2; exit 1; }

curl -fsS -o /dev/null "$BASE/users/$USER_ID" -H "Authorization: Bearer $PROJECT_SECRET"
echo "  GET /users/{id} with the project secret: ok"

cat > "$OUT/project.env" <<ENV
BASE=$BASE
PROJECT_ID=$PROJECT_ID
PROJECT_SECRET=$PROJECT_SECRET
USER_ID=$USER_ID
EMAIL=$EMAIL
PASSWORD=$PASSWORD
ORIGIN=$ORIGIN
ENV
echo "wrote $OUT/project.env"
