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
  local label="$1" port="$2" parent="$3" display="${4:-}"
  kill_port "$port"
  CELL_URL="http://127.0.0.1:${port}" \
  CELL_LABEL="$label" \
  CELL_DISPLAY="$display" \
  LISTEN_ADDR=":${port}" \
  DATA_DIR="$ROOT/.local/data/${label}" \
  IS_PARENT="$parent" \
  .local/bin/cell >".local/logs/${label}.log" 2>&1 &
  echo $! >".local/logs/${label}.pid"
}

rm -rf .local/data
mkdir -p .local/data .local/logs

# Port map: 8100 platform · 8101 eu-1 · 8102 eu-2 · 8103 us-1 · 8104 us-2 · 8105 spare
start_cell platform 8100 true "Platform"
start_cell eu-1 8101 false "EU · Frankfurt"
start_cell eu-2 8102 false "EU · Lisbon"
start_cell us-1 8103 false "US · Iowa"
start_cell us-2 8104 false "US · San Francisco"
start_cell spare 8105 false "Spare"

export PLATFORM_URL=http://127.0.0.1:8100
export EU1_URL=http://127.0.0.1:8101
export EU2_URL=http://127.0.0.1:8102
export US1_URL=http://127.0.0.1:8103
export US2_URL=http://127.0.0.1:8104
"$ROOT/scripts/bootstrap-joins.sh"
"$ROOT/scripts/bootstrap-projects.sh"

kill_port 3000
CELLS="platform=http://127.0.0.1:8100,eu-1=http://127.0.0.1:8101,eu-2=http://127.0.0.1:8102,us-1=http://127.0.0.1:8103,us-2=http://127.0.0.1:8104,spare=http://127.0.0.1:8105" \
LISTEN_ADDR=":3000" \
.local/bin/ui >.local/logs/ui.log 2>&1 &
echo $! >.local/logs/ui.pid

echo "local stack up: UI http://127.0.0.1:3000"
echo "cells: platform=8100 eu-1=8101 eu-2=8102 us-1=8103 us-2=8104 spare=8105"
