# shellcheck shell=bash
# CPU topology and cgroup v2 helpers (ADR 069). Sourced after common.sh.
#
# Two environment variables exist for tests and for running somewhere that is
# not the runner:
#   BENCH_CGROUP_FS     where the cgroup2 hierarchy is mounted (/sys/fs/cgroup)
#   BENCH_SYSFS_CPU     where the CPU topology lives (/sys/devices/system/cpu)
#   BENCH_FAKE_CGROUP=1 BENCH_CGROUP_FS is a plain directory tree standing in
#                       for cgroupfs: mkdir populates the control files a
#                       kernel would, rmdir removes recursively. Tests only.

: "${BENCH_CGROUP_FS:=/sys/fs/cgroup}"
: "${BENCH_SYSFS_CPU:=/sys/devices/system/cpu}"
: "${BENCH_FAKE_CGROUP:=0}"

# ---------------------------------------------------------------- cpu lists

# cpulist_expand "0-2,5": one CPU number per line.
cpulist_expand() {
  tr ',' '\n' <<<"$1" | awk -F- '
    NF == 2 { for (i = $1; i <= $2; i++) print i; next }
    NF == 1 && $1 != "" { print $1 }'
}

# cpulist_union: CPU lists (any form), one per line on stdin, merged into one
# compressed list ("0-2,5").
cpulist_union() {
  local line
  while IFS= read -r line; do
    if [[ -n $line ]]; then cpulist_expand "$line"; fi
  done | sort -n -u | awk '
    NR == 1 { s = p = $1; next }
    $1 == p + 1 { p = $1; next }
    { out = out (out == "" ? "" : ",") (s == p ? s : s "-" p); s = p = $1 }
    END { if (NR) out = out (out == "" ? "" : ",") (s == p ? s : s "-" p); print out }'
}

# cpulist_normalize LIST: one list in the canonical compressed form the kernel
# prints.
cpulist_normalize() { printf '%s\n' "$1" | cpulist_union; }

# cpulist_subset A B: succeeds when every CPU of A is in B.
cpulist_subset() {
  local c
  local -A in_b=()
  for c in $(cpulist_expand "$2"); do in_b[$c]=1; done
  for c in $(cpulist_expand "$1"); do
    [[ -n ${in_b[$c]:-} ]] || return 1
  done
}

# cpulist_disjoint A B: succeeds when A and B share no CPU.
cpulist_disjoint() {
  local c
  local -A in_b=()
  for c in $(cpulist_expand "$2"); do in_b[$c]=1; done
  for c in $(cpulist_expand "$1"); do
    [[ -z ${in_b[$c]:-} ]] || return 1
  done
}

# cpulist_count LIST: how many CPUs.
cpulist_count() { cpulist_expand "$1" | grep -c . || true; }

# ----------------------------------------------------------------- topology

# cpu_usable_cores ALLOWED: one physical core per line, as its SMT sibling
# set ("0,12"), lowest CPU first. A core counts only when every one of its
# siblings is in ALLOWED: a core half-owned by someone else could share an SMT
# sibling with whatever runs there, which is the sharing the partition exists
# to prevent.
cpu_usable_cores() {
  local allowed=$1 cpu sib s ok first f
  local -A in_allowed=()
  for cpu in $(cpulist_expand "$allowed"); do in_allowed[$cpu]=1; done
  for cpu in $(cpulist_expand "$allowed"); do
    f="$BENCH_SYSFS_CPU/cpu$cpu/topology/thread_siblings_list"
    [[ -r $f ]] || bench_die "no CPU topology for cpu$cpu ($f is missing)"
    sib=$(<"$f")
    ok=1
    first=
    for s in $(cpulist_expand "$sib"); do
      [[ -n ${in_allowed[$s]:-} ]] || ok=0
      if [[ -z $first ]] || ((s < first)); then first=$s; fi
    done
    if ((ok)); then printf '%s %s\n' "$first" "$sib"; fi
  done | sort -n -u | cut -d' ' -f2
}

# cpu_plan ALLOWED ROLE:CORES:ACTIVE...: allocate whole physical cores to the
# roles in the order given and print "role|cpus|active" per role (a role with
# no cores has an empty cpus field, which is why the separator is not a space).
#
# Every role is carved out whether or not it runs (ACTIVE=0). The SQLite lane
# has no database process, but its database cores stay reserved and idle
# instead of going to the server, so the server and the load generator get the
# same cores in both lanes and the lanes differ in the database alone.
cpu_plan() {
  local allowed=$1
  shift
  local -a cores=()
  local usable
  # Not `mapfile < <(...)`: a failure inside a process substitution does not
  # reach this shell.
  usable=$(cpu_usable_cores "$allowed")
  mapfile -t cores <<<"$usable"
  [[ -n $usable ]] || cores=()
  local spec role count active need=0
  for spec in "$@"; do
    IFS=: read -r role count active <<<"$spec"
    [[ $count =~ ^[0-9]+$ ]] || bench_die "cores for role '$role' must be a whole number, got '$count'"
    need=$((need + count))
  done
  ((${#cores[@]} >= need)) ||
    bench_die "the partition needs $need whole physical cores but cpuset '$allowed' has ${#cores[@]} usable (a core counts only when all its SMT siblings are available)"
  local idx=0 n
  for spec in "$@"; do
    IFS=: read -r role count active <<<"$spec"
    local picked=()
    for ((n = 0; n < count; n++)); do
      picked+=("${cores[idx]}")
      idx=$((idx + 1))
    done
    printf '%s|%s|%s\n' "$role" "$(printf '%s\n' "${picked[@]:-}" | cpulist_union)" "$active"
  done
}

# ------------------------------------------------------------------ cgroups

cg_self_dir() {
  local rel
  rel=$(sed -n 's/^0:://p' /proc/self/cgroup)
  rel=${rel% (deleted)}
  printf '%s\n' "${BENCH_CGROUP_FS%/}${rel%/}"
}

cg_role_dir() { printf '%s/bench-%s\n' "$1" "$2"; }

cg_read() { # DIR FILE
  { tr -d '\n' <"$1/$2"; } 2>/dev/null || true
}

cg_write() { # DIR FILE VALUE
  if ! { printf '%s\n' "$3" >"$1/$2"; } 2>/dev/null; then
    bench_die "cannot write '$3' to $1/$2: the cgroup is not delegated to this user, the controller is not enabled there, or the value is not allowed"
  fi
}

cg_fake_populate() {
  local d=$1
  : >"$d/cgroup.procs"
  : >"$d/cgroup.subtree_control"
  printf 'cpuset cpu memory pids\n' >"$d/cgroup.controllers"
  : >"$d/cpuset.cpus"
  ln -s cpuset.cpus "$d/cpuset.cpus.effective"
  printf 'member\n' >"$d/cpuset.cpus.partition"
  printf 'max\n' >"$d/memory.max"
  printf 'max\n' >"$d/memory.swap.max"
  printf '0\n' >"$d/memory.oom.group"
  printf '0\n' >"$d/memory.current"
  printf 'low 0\nhigh 0\nmax 0\noom 0\noom_kill 0\noom_group_kill 0\n' >"$d/memory.events"
  printf 'usage_usec 0\nuser_usec 0\nsystem_usec 0\nnr_periods 0\nnr_throttled 0\nthrottled_usec 0\n' >"$d/cpu.stat"
  printf 'max 100000\n' >"$d/cpu.max"
}

cg_mkdir() {
  [[ -d $1 ]] && return 0
  mkdir "$1" 2>/dev/null || bench_die "cannot create cgroup $1: not writable (is the cgroup tree delegated to this user?)"
  if [[ $BENCH_FAKE_CGROUP == 1 ]]; then cg_fake_populate "$1"; fi
}

cg_rmdir() {
  [[ -d $1 ]] || return 0
  if [[ $BENCH_FAKE_CGROUP == 1 ]]; then
    rm -rf "$1"
  else
    rmdir "$1" 2>/dev/null || return 1
  fi
}

cg_pids() { [[ -r $1/cgroup.procs ]] && grep -E '^[0-9]+$' "$1/cgroup.procs" || true; }

# cg_move_pid PID DIR: put a process in a cgroup.
cg_move_pid() {
  if [[ $BENCH_FAKE_CGROUP == 1 ]]; then
    # A real kernel moves the process; the stand-in removes it from every
    # procs file below the fake root first.
    local f
    while IFS= read -r f; do
      grep -vx "$1" "$f" >"$f.tmp" || true
      mv "$f.tmp" "$f"
    done < <(find "$BENCH_CGROUP_FS" -name cgroup.procs)
    printf '%s\n' "$1" >>"$2/cgroup.procs"
  else
    { printf '%s\n' "$1" >"$2/cgroup.procs"; } 2>/dev/null
  fi
}

# cg_move_all FROM TO: move every process of FROM into TO. A process that has
# exited meanwhile, or a kernel thread, is skipped.
cg_move_all() {
  local pid
  for pid in $(cg_pids "$1"); do
    cg_move_pid "$pid" "$2" || true
  done
}

# cg_kill_all DIR: SIGKILL everything in DIR and wait for it to leave.
cg_kill_all() {
  local d=$1 pid n=0
  [[ -d $d ]] || return 0
  if [[ -w $d/cgroup.kill && $BENCH_FAKE_CGROUP != 1 ]]; then
    { printf '1\n' >"$d/cgroup.kill"; } 2>/dev/null || true
  fi
  while [[ -n $(cg_pids "$d") ]] && ((n < 100)); do
    for pid in $(cg_pids "$d"); do kill -KILL "$pid" 2>/dev/null || true; done
    if [[ $BENCH_FAKE_CGROUP == 1 ]]; then : >"$d/cgroup.procs"; fi
    sleep 0.1
    n=$((n + 1))
  done
  [[ -z $(cg_pids "$d") ]]
}

# cg_step_out STATE_FILE: move this process, and the chain of processes that
# started it, out of whatever role cgroup they are in and into the system leaf.
# A teardown started from inside a role (a cleanup step launched through
# `bench-partition exec`) would otherwise kill itself with that role.
cg_step_out() {
  local sys pid
  [[ -r $1 ]] || return 0
  sys=$(jq -r '.system_cgroup // empty' "$1")
  [[ -n $sys && -d $sys ]] || return 0
  pid=$$
  while [[ -n $pid && $pid != 0 && $pid != 1 ]]; do
    cg_move_pid "$pid" "$sys" || true
    pid=$(awk '/^PPid:/ {print $2}' "/proc/$pid/status" 2>/dev/null || true)
  done
}

# cg_run_in DIR CMD...: move this process into DIR, then exec CMD.
cg_run_in() {
  local dir=$1
  shift
  # shellcheck disable=SC2016  # $$ and $1 are for the inner bash, on purpose
  # The PID is written before exec, so the command is in the cgroup from its
  # first instruction and everything it forks inherits it.
  exec bash -c 'printf "%s\n" "$$" >"$1/cgroup.procs" || exit 97; shift; exec "$@"' bench-cg "$dir" "$@"
}

# cg_spawn DIR LOG PIDFILE CMD...: start CMD detached, inside cgroup DIR,
# writing its PID to PIDFILE. stdin is closed so the job's step shell does not
# wait on it.
cg_spawn() {
  local dir=$1 log=$2 pidfile=$3
  shift 3
  # shellcheck disable=SC2016  # $$ and $1 are for the inner bash, on purpose
  setsid bash -c 'printf "%s\n" "$$" >"$1/cgroup.procs" || exit 97; printf "%s\n" "$$" >"$2"; shift 2; exec "$@"' \
    bench-spawn "$dir" "$pidfile" "$@" </dev/null >>"$log" 2>&1 &
}

# --------------------------------------------------------------- preflight

# cg_preflight ROOT: check the delegated cgroup can host the partition. Prints
# the controllers available, one JSON object, and fails with the reason.
cg_preflight() {
  local root=$1 avail c missing=()
  if [[ $BENCH_FAKE_CGROUP != 1 ]]; then
    [[ $(stat -fc %T "$BENCH_CGROUP_FS" 2>/dev/null) == cgroup2fs ]] ||
      bench_die "$BENCH_CGROUP_FS is not a cgroup v2 mount; the partition needs the unified hierarchy"
  fi
  [[ -d $root ]] || bench_die "cgroup root $root does not exist"
  [[ -w $root/cgroup.procs ]] ||
    bench_die "cgroup $root is not writable by this user: delegate it (cgroup v2 delegation, ADR 069) or run the job with a writable cgroup2 mount"
  avail=$(cg_read "$root" cgroup.controllers)
  for c in memory cpu; do
    [[ " $avail " == *" $c "* ]] || missing+=("$c")
  done
  if [[ ${BENCH_ALLOW_NO_CPUSET:-0} != 1 ]]; then
    [[ " $avail " == *" cpuset "* ]] || missing+=(cpuset)
  fi
  if ((${#missing[@]})); then
    bench_die "controller(s) not available in $root: ${missing[*]} (available: $avail). Without cpuset the load generator can share the server's cores; set BENCH_ALLOW_NO_CPUSET=1 only for development, the run is then marked not valid"
  fi
  jq -nc --arg a "$avail" '{available: ($a | split(" "))}'
}

# ---------------------------------------------------------------- snapshots

# cg_snapshot DIR: the record taken at the start and end of every window.
cg_snapshot() {
  local d=$1
  jq -nc \
    --arg dir "$d" \
    --arg cpus "$(cg_read "$d" cpuset.cpus.effective)" \
    --arg cpus_req "$(cg_read "$d" cpuset.cpus)" \
    --arg partition "$(cg_read "$d" cpuset.cpus.partition)" \
    --arg memmax "$(cg_read "$d" memory.max)" \
    --arg swapmax "$(cg_read "$d" memory.swap.max)" \
    --arg memcur "$(cg_read "$d" memory.current)" \
    --arg cpumax "$(cg_read "$d" cpu.max)" \
    --arg pids "$(cg_pids "$d" | tr '\n' ' ')" \
    --argjson events "$(bench_json_file_kv "$d/memory.events")" \
    --argjson cpustat "$(bench_json_file_kv "$d/cpu.stat")" \
    '{cgroup: $dir,
      "cpuset.cpus.effective": $cpus,
      "cpuset.cpus": $cpus_req,
      "cpuset.cpus.partition": $partition,
      "memory.max": $memmax,
      "memory.swap.max": $swapmax,
      "memory.current": $memcur,
      "cpu.max": $cpumax,
      processes: ($pids | split(" ") | map(select(. != "")) | length),
      "memory.events": $events,
      "cpu.stat": $cpustat}'
}
