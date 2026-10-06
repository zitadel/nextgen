# shellcheck shell=bash
# Shared helpers for the benchmark lane tooling (ADR 069). Sourced, never run.

# BENCH_TRACE=1 traces every script (set -x), including after sudo.
if [[ ${BENCH_TRACE:-0} == 1 ]]; then set -x; fi

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

# ----------------------------------------------------------------- privilege

# The partition is made by root (on the Depot VM the job has passwordless
# sudo; a delegated cgroup works unprivileged for development), but the
# server, PostgreSQL and the load generator never run as root: PostgreSQL
# refuses to, and a benchmark of a server that holds root is not one of the
# server users run.
#
# BENCH_PARTITION_MODE:
#   host       the lane owns a cgroup next to the host's own, made partition
#              root so its cores leave every other cgroup (the runner agent
#              included); needs root and elevates itself with sudo
#   delegated  the lane works inside the cgroup it was started in, which must
#              be delegated to the user (development, or a pod); the runner
#              stays inside it, in a `system` leaf
# Unset: host when running as root without BENCH_CGROUP_ROOT, else delegated.
bench_mode() {
  if [[ -n ${BENCH_PARTITION_MODE:-} ]]; then
    printf '%s\n' "$BENCH_PARTITION_MODE"
  elif [[ $EUID -eq 0 && -z ${BENCH_CGROUP_ROOT:-} ]]; then
    printf 'host\n'
  else
    printf 'delegated\n'
  fi
}

# bench_elevate ARGS...: when host mode was asked for and this is not root,
# re-run the script under sudo with the environment kept, remembering which
# user to drop to. Called first by every script; a no-op once root, and with
# the stand-in cgroupfs the tests use.
bench_elevate() {
  [[ ${BENCH_FAKE_CGROUP:-0} == 1 || $EUID -eq 0 ]] && return 0
  [[ ${BENCH_PARTITION_MODE:-} == host ]] || return 0
  command -v sudo >/dev/null 2>&1 || bench_die "host mode needs root and sudo is not installed"
  BENCH_RUN_AS=${BENCH_RUN_AS:-$(id -un)}
  export BENCH_RUN_AS
  exec sudo -n -E env "PATH=$PATH" "$0" "$@"
}

# bench_run_as_prefix: sets BENCH_AS to the words that run a command as the
# unprivileged lane user (empty when not root). The environment is kept, with
# HOME pointed at that user's.
bench_run_as_prefix() {
  BENCH_AS=()
  [[ $EUID -eq 0 && ${BENCH_FAKE_CGROUP:-0} != 1 ]] || return 0
  local user=${BENCH_RUN_AS:-${SUDO_USER:-}}
  [[ -n $user && $user != root ]] ||
    bench_die "running as root: set BENCH_RUN_AS to the unprivileged user that runs the server, PostgreSQL and the load generator"
  local uid gid home
  uid=$(id -u "$user") gid=$(id -g "$user") home=$(getent passwd "$user" | cut -d: -f6)
  # shellcheck disable=SC2034  # read by cg_run_in, cg_spawn and the callers of this
  BENCH_AS=(setpriv "--reuid=$uid" "--regid=$gid" --init-groups -- env "HOME=$home" "USER=$user" "LOGNAME=$user")
}

# bench_chown PATH...: hand paths created as root to the lane user.
bench_chown() {
  [[ $EUID -eq 0 && ${BENCH_FAKE_CGROUP:-0} != 1 ]] || return 0
  local user=${BENCH_RUN_AS:-${SUDO_USER:-}}
  [[ -n $user && $user != root ]] || return 0
  chown -R "$user:$(id -gn "$user")" "$@"
}
