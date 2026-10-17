#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
mkdir -p .local/data .local/bin .local/logs
go build -o .local/bin/cell ./cmd/cell
go build -o .local/bin/ui ./cmd/ui

kill_port() {
  local port="$1"
  if command -v fuser >/dev/null 2>&1; then
    fuser -k "${port}/tcp" >/dev/null 2>&1 || true
  fi
}

start_cell() {
  local label="$1" port="$2" parent="$3"
  kill_port "$port"
  CELL_URL="http://127.0.0.1:${port}" \
  CELL_LABEL="$label" \
  LISTEN_ADDR=":${port}" \
  DATA_DIR="$ROOT/.local/data/${label}" \
  IS_PARENT="$parent" \
  .local/bin/cell >".local/logs/${label}.log" 2>&1 &
  echo $! >".local/logs/${label}.pid"
}

rm -rf .local/data
mkdir -p .local/data .local/logs

start_cell platform 8100 true
start_cell eu 8101 true
start_cell eu-1 8102 false
start_cell eu-2 8103 false
start_cell us 8104 false
start_cell aus 8105 false
start_cell spare 8106 false

export PLATFORM_URL=http://127.0.0.1:8100
export EU_URL=http://127.0.0.1:8101
export EU1_URL=http://127.0.0.1:8102
export EU2_URL=http://127.0.0.1:8103
export US_URL=http://127.0.0.1:8104
export AUS_URL=http://127.0.0.1:8105
"$ROOT/scripts/bootstrap-joins.sh"

kill_port 3000
CELLS="platform=http://127.0.0.1:8100,eu=http://127.0.0.1:8101,eu-1=http://127.0.0.1:8102,eu-2=http://127.0.0.1:8103,us=http://127.0.0.1:8104,aus=http://127.0.0.1:8105,spare=http://127.0.0.1:8106" \
LISTEN_ADDR=":3000" \
.local/bin/ui >.local/logs/ui.log 2>&1 &
echo $! >.local/logs/ui.pid

echo "local stack up: UI http://127.0.0.1:3000"
