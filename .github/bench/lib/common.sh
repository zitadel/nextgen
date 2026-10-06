# shellcheck shell=bash
# Shared helpers for the benchmark lane tooling (ADR 069). Sourced, never run.

bench_log() { printf 'bench: %s\n' "$*" >&2; }
bench_warn() { printf 'bench: warning: %s\n' "$*" >&2; }
bench_die() {
  printf 'bench: error: %s\n' "$*" >&2
  exit 1
}

# bench_need CMD...: fail with one message naming every missing command.
bench_need() {
  local missing=() c
  for c in "$@"; do
    command -v "$c" >/dev/null 2>&1 || missing+=("$c")
  done
  if ((${#missing[@]})); then
    bench_die "required command(s) not found: ${missing[*]}"
  fi
}

# The directory holding bin/, lib/ and lanes/.
bench_home() {
  local here
  here=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
  printf '%s\n' "$here"
}

# State that must outlive one script invocation, so that a teardown started
# from a fresh shell (a cancelled job's cleanup step) finds what the run
# created. One active lane per runner: the dedicated runner runs one job at a
# time, and the workflow serialises lanes with a concurrency group.
: "${BENCH_STATE_DIR:=${TMPDIR:-/tmp}/bench-lane-$(id -u)}"

bench_state_active() { printf '%s/active.json\n' "$BENCH_STATE_DIR"; }

bench_now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# Seconds since boot with centisecond resolution; a monotonic stamp that a
# wall-clock step cannot move.
bench_uptime() { awk '{print $1}' /proc/uptime; }

# bench_json_file_kv FILE: a flat "key value" file (memory.events, cpu.stat)
# as one JSON object of numbers. A missing file is an empty object.
bench_json_file_kv() {
  if [[ -r $1 ]]; then
    jq -Rn '[inputs | split(" ") | select(length == 2) | {(.[0]): (.[1] | tonumber? // .[1])}] | add // {}' <"$1"
  else
    printf '{}\n'
  fi
}

bench_sha256() { sha256sum "$1" | awk '{print $1}'; }

# bench_load_env FILE: source a lane definition under `set -a` so every
# assignment is exported to the children the lane starts.
bench_load_env() {
  [[ -r $1 ]] || bench_die "lane definition not readable: $1"
  set -a
  # shellcheck disable=SC1090
  . "$1"
  set +a
}

# bench_start_ticks PID: the process start time in clock ticks since boot
# (field 22 of /proc/PID/stat). Together with the PID it identifies one
# process lifetime; a recycled PID has a different value.
bench_start_ticks() {
  local stat rest
  stat=$(cat "/proc/$1/stat" 2>/dev/null) || return 1
  # The command name is in parentheses and may contain spaces: cut after the
  # last ')' and count from there (field 3 is the first one left).
  rest=${stat##*) }
  # shellcheck disable=SC2086
  set -- $rest
  printf '%s\n' "${20}"
}
