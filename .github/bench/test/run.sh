#!/usr/bin/env bash
# Tests for the benchmark lane tooling. Plain bash, no privileges: cgroupfs is a
# directory tree standing in for the kernel's (BENCH_FAKE_CGROUP=1) and the CPU
# topology is generated, so the allocation logic, the partition lifecycle, the
# window verdicts and the lane invariants run on any Linux box and in CI.
#
# What this cannot show is the kernel enforcing a cpuset; that needs a cgroup
# with the cpuset controller delegated (the runner) and is what
# bin/bench-verify-isolation demonstrates there.
#
#   .github/bench/test/run.sh [TEST...]
# The tests set the environment inside subshells on purpose.
# shellcheck disable=SC2030,SC2031
set -uo pipefail
shopt -s inherit_errexit

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
# shellcheck source=../lib/common.sh
. "$HERE/lib/common.sh"
# shellcheck source=../lib/cgroup.sh
. "$HERE/lib/cgroup.sh"
# shellcheck source=../lib/lane.sh
. "$HERE/lib/lane.sh"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
FAILED=0
PASSED=0

pass() { PASSED=$((PASSED + 1)); printf '  ok   %s\n' "$1"; }
fail() { FAILED=$((FAILED + 1)); printf '  FAIL %s\n' "$1"; }

# check DESC CMD...: the command must succeed.
check() {
  local desc=$1
  shift
  if ("$@") >/dev/null 2>&1; then pass "$desc"; else fail "$desc"; fi
}
# refuse DESC CMD...: the command must fail.
refuse() {
  local desc=$1
  shift
  if ("$@") >/dev/null 2>&1; then fail "$desc"; else pass "$desc"; fi
}
eq() { # DESC EXPECTED ACTUAL
  if [[ $2 == "$3" ]]; then pass "$1"; else fail "$1 (expected '$2', got '$3')"; fi
}

# fake_sysfs DIR CORES THREADS_PER_CORE: cpu<n> numbered like a typical x86
# part: the first CORES CPUs are thread 0 of each core, the next CORES their
# SMT siblings.
fake_sysfs() {
  local d=$1 ncores=$2 tpc=$3 c t cpu sib
  for ((c = 0; c < ncores; c++)); do
    sib=''
    for ((t = 0; t < tpc; t++)); do sib+="${sib:+,}$((c + t * ncores))"; done
    for ((t = 0; t < tpc; t++)); do
      cpu=$((c + t * ncores))
      mkdir -p "$d/cpu$cpu/topology"
      printf '%s\n' "$sib" >"$d/cpu$cpu/topology/thread_siblings_list"
    done
  done
  printf '0-%s\n' "$((ncores * tpc - 1))" >"$d/online"
}

# fake_cgroups DIR CPUS: a delegated cgroup with processes in it.
fake_cgroups() {
  local d=$1 cpus=$2
  mkdir -p "$d/pod"
  BENCH_FAKE_CGROUP=1 cg_fake_populate "$d/pod"
  rm -f "$d/pod/cpuset.cpus.effective"
  printf '%s\n' "$cpus" >"$d/pod/cpuset.cpus.effective"
  printf '1111\n2222\n' >"$d/pod/cgroup.procs"
}

# A small partition: 4 cores, one per role, on an 8-CPU, 4-core fake machine.
small_env() { # WORKDIR
  export BENCH_FAKE_CGROUP=1 BENCH_CGROUP_FS=$1/cg BENCH_CGROUP_ROOT=$1/cg/pod BENCH_SYSFS_CPU=$1/sysfs
  export BENCH_STATE_DIR=$1/state BENCH_DATA_ROOT=$1/data
  export BENCH_CORES_SYSTEM=1 BENCH_CORES_SERVER=1 BENCH_CORES_DB=1 BENCH_CORES_COLLECTOR=0 BENCH_CORES_LOADGEN=1
  export BENCH_MEM_SERVER_MIB=128 BENCH_MEM_DB_MIB=64 BENCH_MEM_LOADGEN_MIB=64 BENCH_MEM_COLLECTOR_MIB=16
  # Populated once per work directory, so a later call in the same test sees
  # the state the earlier one left.
  [[ -d $1/sysfs ]] || fake_sysfs "$1/sysfs" 4 2
  [[ -d $1/cg/pod ]] || fake_cgroups "$1/cg" 0-7
}

# ------------------------------------------------------------------ the tests

t_cpulists() {
  eq "expand" "0 1 2 5" "$(cpulist_expand 0-2,5 | tr '\n' ' ' | sed 's/ $//')"
  eq "union compresses" "0-2,5,8-9" "$(printf '%s\n' 0,1 2 5 8-9 | cpulist_union)"
  check "subset" cpulist_subset 1-2 0-3
  refuse "not a subset" cpulist_subset 1-4 0-3
  check "disjoint" cpulist_disjoint 0-1 2-3
  refuse "overlapping" cpulist_disjoint 0-2 2-3
}

t_topology() {
  local w=$WORK/topo
  mkdir -p "$w"
  fake_sysfs "$w/sysfs" 4 2
  export BENCH_SYSFS_CPU=$w/sysfs
  eq "four cores of two threads" "0,4
1,5
2,6
3,7" "$(cpu_usable_cores 0-7)"
  # CPU 5 is not ours: the core (1,5) is only half available and must not be
  # handed out, or its sibling could run something else next to a measured core.
  eq "a half-owned core is not usable" "0,4
2,6
3,7" "$(cpu_usable_cores 0-4,6-7)"
  eq "plan hands out whole cores in order" "a|0,4|1
b|1-2,5-6|1" "$(cpu_plan 0-7 a:1:1 b:2:1)"
  refuse "plan refuses more cores than exist" cpu_plan 0-7 a:5:1
  eq "inactive roles still reserve their cores" "a|0,4|0
b|1,5|1" "$(cpu_plan 0-7 a:1:0 b:1:1)"
  local plan
  plan=$(cpu_plan 0-7 s:1:1 srv:1:1 db:1:1 lg:1:1)
  local shared=0 a b
  while IFS='|' read -r a _; do
    while IFS='|' read -r b _; do
      if [[ $a != "$b" ]] && ! cpulist_disjoint "$(awk -F'|' -v r="$a" '$1 == r {print $2}' <<<"$plan")" "$(awk -F'|' -v r="$b" '$1 == r {print $2}' <<<"$plan")"; then
        shared=1
      fi
    done <<<"$plan"
  done <<<"$plan"
  eq "no two roles share a CPU (so none shares an SMT sibling)" 0 "$shared"
}

t_lanes() {
  local w=$WORK/lanes
  mkdir -p "$w"
  export BENCH_STATE_DIR=$w/state
  # Same hardware, same plan: the server and the load generator get identical
  # cores in both lanes, and the database cores stay reserved in SQLite's.
  fake_sysfs "$w/sysfs" 16 2
  export BENCH_SYSFS_CPU=$w/sysfs BENCH_CGROUP_ROOT=$w/cg/pod BENCH_FAKE_CGROUP=1 BENCH_CGROUP_FS=$w/cg
  # The server keeps its computed argon2id budget (asserted below); the others
  # are small so the plan fits any machine's memory.
  export BENCH_MEM_DB_MIB=64 BENCH_MEM_LOADGEN_MIB=64 BENCH_MEM_COLLECTOR_MIB=16
  fake_cgroups "$w/cg" 0-31
  local sq pg
  sq=$("$HERE/bin/bench-partition" plan --lane sqlite)
  pg=$("$HERE/bin/bench-partition" plan --lane postgres)
  eq "server cores identical across lanes" "$(jq -c .roles.server.cpus <<<"$pg")" "$(jq -c .roles.server.cpus <<<"$sq")"
  eq "load generator cores identical across lanes" "$(jq -c .roles.loadgen.cpus <<<"$pg")" "$(jq -c .roles.loadgen.cpus <<<"$sq")"
  eq "server memory identical across lanes" "$(jq -c .roles.server.memory_max_bytes <<<"$pg")" "$(jq -c .roles.server.memory_max_bytes <<<"$sq")"
  eq "sqlite lane has no database cgroup" false "$(jq -r .roles.db.active <<<"$sq")"
  eq "postgres lane has one" true "$(jq -r .roles.db.active <<<"$pg")"
  eq "database cores are reserved in the sqlite lane" "$(jq -c .roles.db.cpus <<<"$pg")" "$(jq -c .roles.db.cpus <<<"$sq")"
  eq "the server limit is the argon2id budget (1024 + 32 x 64 MiB)" 3221225472 "$(jq -r .roles.server.memory_max_bytes <<<"$sq")"
  refuse "an unknown lane is refused" "$HERE/bin/bench-partition" plan --lane nope

  # The lane definitions may differ in the database and nothing else.
  local keys
  keys=$(grep -hE '^[A-Z_]+=' "$HERE/lanes/sqlite.env" "$HERE/lanes/postgres.env" | cut -d= -f1 | sort -u | tr '\n' ' ')
  eq "lane files set only the database keys" "BENCH_DB_DIALECT BENCH_DB_ROLE BENCH_LANE BENCH_SERVER_REPLICAS " "$keys"
  check "server.yaml leaves the dialect to the environment" bash -c "! grep -Eq '^database:' '$HERE/server.yaml'"
  eq "argon2id memory is read from server.yaml" 65536 "$(BENCH_SERVER_CONFIG=$HERE/server.yaml lane_argon_mem_kib)"
  eq "yaml_get walks nested keys" warn "$(yaml_get "$HERE/server.yaml" instrumentation.log.level)"
}

t_replicas() {
  local w=$WORK/replicas
  mkdir -p "$w"
  export BENCH_STATE_DIR=$w/state
  # shellcheck disable=SC2329,SC2317  # called through check/refuse
  two_replicas() { lane_load "$1"; BENCH_SERVER_REPLICAS=2; lane_validate; }
  # shellcheck disable=SC2329,SC2317  # called through check/refuse
  lane_file_wins() {
    # The environment cannot reconfigure a lane: the lane file is sourced last.
    export BENCH_SERVER_REPLICAS=3 BENCH_DB_DIALECT=postgres BENCH_DB_ROLE=1
    lane_load sqlite
    [[ $BENCH_SERVER_REPLICAS == 1 && $BENCH_DB_DIALECT == sqlite && $BENCH_DB_ROLE == 0 ]]
  }
  refuse "sqlite with two replicas is refused" two_replicas sqlite
  check "the lane file wins over the environment" lane_file_wins
  refuse "two replicas are refused in the postgres lane too" two_replicas postgres

  # The data directory lock: the second server on it exits 75 and does not run.
  local dir=$w/datadir rc=0
  mkdir -p "$dir"
  flock --no-fork -n -E 75 "$dir" sleep 4 &
  local holder=$!
  sleep 0.3
  flock --no-fork -n -E 75 "$dir" true >/dev/null 2>&1 || rc=$?
  eq "a second process on the data directory exits 75" 75 "$rc"
  kill "$holder" 2>/dev/null
  wait "$holder" 2>/dev/null
  # Same primitive in the code that starts the server.
  # shellcheck disable=SC2016  # the pattern is literal text of the script
  check "server_up takes the data-directory lock" grep -qF 'flock --no-fork -n -E 75 "$datadir"' "$HERE/lib/lane.sh"
}

t_disk() {
  local w=$WORK/disk
  mkdir -p "$w"
  export BENCH_ALLOW_DISK_KINDS=''
  refuse "a network filesystem is refused" disk_check '{"kind":"network","fstype":"nfs4","path":"/x"}'
  refuse "tmpfs is refused by default" disk_check '{"kind":"memory","fstype":"tmpfs","path":"/x"}'
  BENCH_ALLOW_DISK_KINDS="memory" check "tmpfs can be allowed explicitly" disk_check '{"kind":"memory","fstype":"tmpfs","path":"/x"}'
  BENCH_ALLOW_DISK_KINDS="memory" refuse "a network filesystem is refused even when other kinds are allowed" disk_check '{"kind":"network","fstype":"nfs4","path":"/x"}'
  refuse "a cloud block volume is not a local disk" disk_check '{"kind":"network-block","fstype":"ext4","path":"/x","device":"nvme0n1","model":"Amazon Elastic Block Store"}'
  BENCH_ALLOW_DISK_KINDS="network-block" check "a cloud block volume can be accepted explicitly" disk_check '{"kind":"network-block","fstype":"ext4","path":"/x"}'
  check "an nvme disk passes" disk_check '{"kind":"nvme","fstype":"ext4","path":"/x"}'
  local info
  info=$(disk_info "$w")
  check "disk_info reports a kind and a filesystem" jq -e '.kind != null and .fstype != ""' <<<"$info"
}

t_partition() {
  local w=$WORK/part
  mkdir -p "$w"
  (
    small_env "$w"
    "$HERE/bin/bench-partition" up --lane postgres --run-dir "$w/run" >"$w/up.log" 2>&1 || { tail -n 5 "$w/up.log" >&2; exit 1; }
    pod=$w/cg/pod
    [[ -d $pod/bench-system && -d $pod/bench-server && -d $pod/bench-db && -d $pod/bench-loadgen ]] || exit 2
    [[ ! -d $pod/bench-collector ]] || exit 3
    [[ $(<"$pod/bench-server/cpuset.cpus") == 1,5 ]] || exit 4
    [[ $(<"$pod/bench-db/cpuset.cpus") == 2,6 ]] || exit 5
    [[ $(<"$pod/bench-loadgen/cpuset.cpus") == 3,7 ]] || exit 6
    [[ $(<"$pod/bench-system/cpuset.cpus") == 0,4 ]] || exit 7
    [[ $(<"$pod/bench-server/memory.max") == $((128 * 1048576)) ]] || exit 8
    [[ $(<"$pod/bench-server/memory.oom.group") == 1 ]] || exit 9
    [[ $(<"$pod/bench-loadgen/cpu.max") == "max 100000" ]] || exit 10
    # No process of its own left in the cgroup that hands controllers out.
    [[ -z $(cg_pids "$pod") ]] || exit 11
    [[ $(sort "$pod/bench-system/cgroup.procs" | tr '\n' ' ') == "1111 2222 " ]] || exit 12
    [[ $(<"$pod/cgroup.subtree_control") != "" ]] || exit 13
    jq -e '.cpuset_applied == true' "$w/run/partition.json" >/dev/null || exit 14
    # A second `up` while one is active is refused rather than layered.
    "$HERE/bin/bench-partition" up --lane postgres --run-dir "$w/run2" >/dev/null 2>&1 && exit 15
    exit 0
  )
  local rc=$?
  eq "partition up creates the cgroups, cpusets, limits and moves the runner out" 0 "$rc"
  (
    small_env "$w"
    "$HERE/bin/bench-partition" down >/dev/null 2>&1 || exit 1
    "$HERE/bin/bench-partition" down >/dev/null 2>&1 || exit 2   # idempotent
    pod=$w/cg/pod
    [[ ! -d $pod/bench-server && ! -d $pod/bench-system && ! -d $pod/bench-loadgen && ! -d $pod/bench-db ]] || exit 3
    # (A real kernel also drops the exited teardown process; the stand-in keeps it.)
    grep -qx 1111 "$pod/cgroup.procs" && grep -qx 2222 "$pod/cgroup.procs" || exit 4
    [[ ! -e $BENCH_STATE_DIR/partition.json ]] || exit 5
    exit 0
  )
  eq "partition down is idempotent and restores the cgroup" 0 $?
  (
    small_env "$w"
    "$HERE/bin/bench-partition" down >/dev/null 2>&1
  )
  eq "partition down with nothing to tear down succeeds" 0 $?
  (
    small_env "$w"
    export BENCH_CORES_LOADGEN=9
    "$HERE/bin/bench-partition" up --lane sqlite --run-dir "$w/run3" >/dev/null 2>&1 && exit 1
    # A refused plan leaves nothing behind.
    [[ ! -d $w/cg/pod/bench-system && ! -e $BENCH_STATE_DIR/partition.json ]] || exit 2
    exit 0
  )
  eq "an impossible plan fails before touching anything" 0 $?
  (
    small_env "$w"
    "$HERE/bin/bench-partition" up --lane sqlite --run-dir "$w/run4" >/dev/null 2>&1 || exit 1
    jq -e '.roles.db.active == false and (.roles.collector.active == false)' "$w/run4/partition.json" >/dev/null || exit 2
    [[ ! -d $w/cg/pod/bench-db ]] || exit 3
    "$HERE/bin/bench-partition" down >/dev/null 2>&1
  )
  eq "the sqlite lane creates no database cgroup" 0 $?
}

t_host_mode() {
  local w=$WORK/host
  mkdir -p "$w"
  unset BENCH_CGROUP_ROOT BENCH_ALLOWED_CPUS
  (
    export BENCH_FAKE_CGROUP=1 BENCH_CGROUP_FS=$w/cg BENCH_SYSFS_CPU=$w/sysfs BENCH_PARTITION_MODE=host
    export BENCH_STATE_DIR=$w/state BENCH_DATA_ROOT=$w/data
    export BENCH_CORES_SYSTEM=1 BENCH_CORES_SERVER=1 BENCH_CORES_DB=1 BENCH_CORES_COLLECTOR=0 BENCH_CORES_LOADGEN=1
    export BENCH_MEM_SERVER_MIB=128 BENCH_MEM_DB_MIB=64 BENCH_MEM_LOADGEN_MIB=64 BENCH_MEM_COLLECTOR_MIB=16
    fake_sysfs "$w/sysfs" 4 2
    mkdir -p "$w/cg"
    cg_fake_populate "$w/cg"
    rm -f "$w/cg/cpuset.cpus.effective"
    printf '0-7\n' >"$w/cg/cpuset.cpus.effective"
    bp="$HERE/bin/bench-partition"
    "$bp" up --lane postgres --run-dir "$w/run" >"$w/up.log" 2>&1 || { tail -n 5 "$w/up.log" >&2; exit 1; }
    root=$w/cg/bench-lane
    # The cores of the roles are one partition root; the runner's cores are the rest.
    [[ $(<"$root/cpuset.cpus") == 1-3,5-7 ]] || exit 2
    [[ $(<"$root/cpuset.cpus.partition") == root ]] || exit 3
    [[ $(<"$root/bench-server/cpuset.cpus") == 1,5 && $(<"$root/bench-loadgen/cpuset.cpus") == 3,7 ]] || exit 4
    [[ ! -d $root/bench-system ]] || exit 5
    jq -e '.mode == "host" and .roles.system.outside == true and .roles.system.cpus == "0,4" and .roles.system.cgroup == ""' "$w/run/partition.json" >/dev/null || exit 6
    jq -e '.bench_cpus == "1-3,5-7"' "$w/run/partition.json" >/dev/null || exit 7
    # A window works the same, and a bare `exec system` is not in any cgroup.
    "$HERE/bin/bench-window" run hostwin -- true >"$w/win.log" 2>&1 || { cat "$w/win.log" >&2; exit 8; }
    # The lane's `assert-clean` fails while it is up and passes after teardown.
    "$HERE/bin/bench-partition" down >/dev/null 2>&1 || exit 9
    [[ ! -d $root && ! -e $BENCH_STATE_DIR/partition.json ]] || exit 10
    "$HERE/bin/bench-partition" down >/dev/null 2>&1 || exit 11
    "$HERE/bin/bench-lane" assert-clean >"$w/clean.log" 2>&1 || { cat "$w/clean.log" >&2; exit 12; }
    exit 0
  )
  eq "host mode: the roles' cores are one partition root, the runner keeps the rest, teardown removes it" 0 $?
  (
    export BENCH_FAKE_CGROUP=1 BENCH_CGROUP_FS=$w/cg BENCH_SYSFS_CPU=$w/sysfs BENCH_PARTITION_MODE=host BENCH_STATE_DIR=$w/state2
    mkdir -p "$w/cg/bench-lane/x"
    "$HERE/bin/bench-lane" assert-clean >/dev/null 2>&1 && exit 1
    exit 0
  )
  eq "assert-clean fails while a lane's cgroup is left behind" 0 $?
}

t_windows() {
  local w=$WORK/win
  mkdir -p "$w"
  (
    small_env "$w"
    "$HERE/bin/bench-partition" up --lane postgres --run-dir "$w/run" >/dev/null 2>&1 || exit 1
    pod=$w/cg/pod
    win="$HERE/bin/bench-window"

    # A quiet window is valid and records the four files per role.
    "$win" begin quiet >/dev/null 2>&1 || exit 2
    "$win" end quiet >/dev/null 2>&1 || exit 3
    jq -e '.valid == true and .reasons == []' "$w/run/windows/quiet/verdict.json" >/dev/null || exit 4
    jq -e '.roles.server | has("cpuset.cpus.effective") and has("memory.max") and has("memory.events") and has("cpu.stat")' \
      "$w/run/windows/quiet/start.json" >/dev/null || exit 5

    # An OOM kill in the server's cgroup invalidates it.
    "$win" begin oom >/dev/null 2>&1
    sed -i 's/^oom_kill 0/oom_kill 1/' "$pod/bench-server/memory.events"
    "$win" end oom >/dev/null 2>&1 && exit 6
    jq -e '.valid == false and (.reasons[0] | test("oom_kill of server"))' "$w/run/windows/oom/verdict.json" >/dev/null || exit 7
    sed -i 's/^oom_kill 1/oom_kill 0/' "$pod/bench-server/memory.events"

    # A throttling increase in the server's cgroup, or the database's, invalidates it.
    "$win" begin throttle >/dev/null 2>&1
    sed -i 's/^nr_throttled 0/nr_throttled 3/' "$pod/bench-db/cpu.stat"
    "$win" end throttle >/dev/null 2>&1 && exit 8
    jq -e '(.reasons | map(test("nr_throttled of db")) | any)' "$w/run/windows/throttle/verdict.json" >/dev/null || exit 9
    sed -i 's/^nr_throttled 3/nr_throttled 0/' "$pod/bench-db/cpu.stat"

    # The load generator being throttled is not the server's problem.
    "$win" begin lg >/dev/null 2>&1
    sed -i 's/^nr_throttled 0/nr_throttled 3/' "$pod/bench-loadgen/cpu.stat"
    "$win" end lg >/dev/null 2>&1 || exit 10
    sed -i 's/^nr_throttled 3/nr_throttled 0/' "$pod/bench-loadgen/cpu.stat"

    # A cpuset that moved during the window, or memory.max that did.
    "$win" begin cpus >/dev/null 2>&1
    printf '1-2,5-6\n' >"$pod/bench-server/cpuset.cpus"
    "$win" end cpus >/dev/null 2>&1 && exit 11
    jq -e '(.reasons | map(test("cpuset.cpus.effective of server changed")) | any)' "$w/run/windows/cpus/verdict.json" >/dev/null || exit 12
    printf '1,5\n' >"$pod/bench-server/cpuset.cpus"
    "$win" begin mem >/dev/null 2>&1
    printf '64\n' >"$pod/bench-server/memory.max"
    "$win" end mem >/dev/null 2>&1 && exit 13
    printf '%s\n' "$((128 * 1048576))" >"$pod/bench-server/memory.max"

    # `run` keeps the command's status and fails an invalid window.
    "$win" run okrun -- true >/dev/null 2>&1 || exit 14
    "$win" run failrun -- false >/dev/null 2>&1 && exit 15
    exit 0
  )
  eq "window verdicts: OOM, throttling, cpuset and memory.max changes invalidate; a throttled load generator does not" 0 $?
  (
    small_env "$w"
    "$HERE/bin/bench-partition" down >/dev/null 2>&1
  )

  # Boot marker and server count, from hand-made records.
  local plan='{"cpuset_applied":true,"roles":{}}'
  local start end
  start='{"name":"w","at":"a","uptime":"1.0","roles":{},"boot_marker":{"digest":"aaa"},"servers":{"in_cgroup":1,"total":1,"expected":1}}'
  end='{"name":"w","at":"b","uptime":"2.5","roles":{},"boot_marker":{"digest":"aaa"},"servers":{"in_cgroup":1,"total":1,"expected":1}}'
  printf '%s' "$start" >"$WORK/s.json"
  printf '%s' "$end" >"$WORK/e.json"
  printf '%s' "$plan" >"$WORK/p.json"
  eq "same boot marker and one server: valid" true "$("$HERE/bin/bench-window" verdict "$WORK/s.json" "$WORK/e.json" "$WORK/p.json" | jq -r .valid)"
  printf '%s' "${end//aaa/bbb}" >"$WORK/e2.json"
  eq "a changed boot marker invalidates the window" false "$("$HERE/bin/bench-window" verdict "$WORK/s.json" "$WORK/e2.json" "$WORK/p.json" | jq -r .valid)"
  printf '%s' "${end//\"total\":1/\"total\":2}" >"$WORK/e3.json"
  eq "a second server process invalidates the window" false "$("$HERE/bin/bench-window" verdict "$WORK/s.json" "$WORK/e3.json" "$WORK/p.json" | jq -r .valid)"
  printf '%s' '{"cpuset_applied":false,"roles":{}}' >"$WORK/p2.json"
  eq "no cpuset partition invalidates the window" false "$("$HERE/bin/bench-window" verdict "$WORK/s.json" "$WORK/e.json" "$WORK/p2.json" | jq -r .valid)"
}

t_boot_marker() {
  local w=$WORK/marker
  mkdir -p "$w/run/pids"
  # Bash scopes `local` dynamically, so the callee sees these.
  marker_of() {
    local BENCH_DB_DIALECT=postgres BENCH_DATA_ROOT=$w/data
    lane_boot_marker "$1"
  }
  sleep 30 &
  local p1=$!
  echo "$p1" >"$w/run/pids/server.pid"
  local m1 m2 m3
  m1=$(marker_of "$w/run" | jq -r .digest)
  m2=$(marker_of "$w/run" | jq -r .digest)
  eq "the marker is stable while the process lives" "$m1" "$m2"
  kill "$p1"
  wait "$p1" 2>/dev/null
  sleep 30 &
  local p2=$!
  echo "$p2" >"$w/run/pids/server.pid"
  m3=$(marker_of "$w/run" | jq -r .digest)
  if [[ $m1 != "$m3" ]]; then pass "a restarted server changes the marker"; else fail "a restarted server changes the marker"; fi
  kill "$p2"
  wait "$p2" 2>/dev/null
  m3=$(marker_of "$w/run" | jq -r '.server.start_ticks')
  eq "a dead server has no start time in the marker" "" "$m3"
}

t_compare_and_declare() {
  local w=$WORK/cmp
  mkdir -p "$w"
  local base='{"schema":"bench-lane-run/v1","lane":"sqlite","source":{"commit":"abc"},
    "host":{"cpu_model":"x","kernel":"6","machine_type":{"value":"m"}},
    "partition":{"cpuset_applied":true,"roles":{
      "system":{"cores":1,"cpus":"0","memory_max_bytes":null,"active":true},
      "server":{"cores":4,"cpus":"1-4","memory_max_bytes":3,"active":true},
      "db":{"cores":2,"cpus":"5-6","memory_max_bytes":4,"active":false},
      "collector":{"cores":1,"cpus":"7","memory_max_bytes":1,"active":false},
      "loadgen":{"cores":3,"cpus":"8-10","memory_max_bytes":2,"active":true}}},
    "server":{"binary_sha256":"s1","config_sha256":"c1","replicas":1},
    "collector":{"enabled":false,"config_sha256":null,"command":""},
    "declare":{"dialect":"sqlite","replicas":"1","log_level":"warn","cgroup_server_cpus":"1-4"}}'
  printf '%s' "$base" >"$w/a.json"
  jq '.lane = "postgres" | .partition.roles.db.active = true' <<<"$base" >"$w/b.json"
  check "two lanes that differ in the database only compare equal" "$HERE/bin/bench-lane" compare "$w/a.json" "$w/b.json"
  jq '.lane = "postgres" | .server.binary_sha256 = "other"' <<<"$base" >"$w/c.json"
  refuse "a different server build is a difference" "$HERE/bin/bench-lane" compare "$w/a.json" "$w/c.json"
  jq '.lane = "postgres" | .partition.roles.server.cores = 5' <<<"$base" >"$w/d.json"
  refuse "a different server allocation is a difference" "$HERE/bin/bench-lane" compare "$w/a.json" "$w/d.json"
  jq '.lane = "postgres" | .collector.config_sha256 = "x" | .collector.enabled = true' <<<"$base" >"$w/e.json"
  refuse "a different collector configuration is a difference" "$HERE/bin/bench-lane" compare "$w/a.json" "$w/e.json"
  eq "declare-args emits doctor flags" "--declare=dialect=sqlite
--declare=replicas=1
--declare=log_level=warn
--declare=cgroup_server_cpus=1-4" "$("$HERE/bin/bench-lane" declare-args "$w/a.json")"
}

t_workflow_and_scripts() {
  local f
  for f in "$HERE"/bin/* "$HERE"/lib/*.sh "$HERE"/test/run.sh; do
    check "bash -n $(basename "$f")" bash -n "$f"
  done
  if command -v shellcheck >/dev/null 2>&1; then
    check "shellcheck is clean" shellcheck -x "$HERE"/bin/* "$HERE"/lib/*.sh "$HERE"/test/run.sh
  else
    printf '  skip shellcheck (not installed)\n'
  fi
}

ALL=(cpulists topology lanes replicas disk partition host_mode windows boot_marker compare_and_declare workflow_and_scripts)
if (($#)); then ALL=("$@"); fi
for t in "${ALL[@]}"; do
  printf '%s\n' "$t"
  "t_$t"
done
printf '\n%s passed, %s failed\n' "$PASSED" "$FAILED"
((FAILED == 0))
