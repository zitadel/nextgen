# shellcheck shell=bash
# Lane definition, sizing, disk, PostgreSQL and server helpers (ADR 069).
# Sourced after common.sh and cgroup.sh.

# yaml_get FILE PATH: the scalar at a dotted path in a block-style YAML file
# (password_hasher.hasher.memory). Enough for the one file this tooling reads
# and no more: no flow style, no anchors, no multi-line scalars.
yaml_get() {
  awk -v want="$2" '
    { line = $0; sub(/[[:space:]]*#.*$/, "", line) }
    line ~ /^[[:space:]]*$/ { next }
    {
      match(line, /^ */); ind = RLENGTH
      key = line; sub(/^ */, "", key)
      if (key !~ /^[A-Za-z0-9_]+:/) next
      name = key; sub(/:.*/, "", name)
      val = key; sub(/^[^:]*:[[:space:]]*/, "", val)
      while (depth > 0 && ind <= indents[depth]) depth--
      depth++; indents[depth] = ind; names[depth] = name
      path = names[1]
      for (i = 2; i <= depth; i++) path = path "." names[i]
      if (path == want && val != "") { gsub(/^"|"$/, "", val); print val; exit }
    }' "$1"
}

# lane_load LANE: load common.env, then the lane definition. The lane file is
# sourced last and wins, so a lane can not be reconfigured from the
# environment, and it is the only place the dialect is set.
lane_load() {
  local lane=$1 home
  home=$(bench_home)
  if [[ ! $lane =~ ^[a-z][a-z0-9-]*$ || ! -r $home/lanes/$lane.env ]]; then
    bench_die "unknown lane '$lane' (known: $(find "$home/lanes" -name '*.env' ! -name common.env -printf '%f\n' | sed 's/\.env$//' | sort | tr '\n' ' '))"
  fi
  bench_load_env "$home/lanes/common.env"
  bench_load_env "$home/lanes/$lane.env"
  [[ ${BENCH_LANE:-} == "$lane" ]] || bench_die "lanes/$lane.env sets BENCH_LANE='${BENCH_LANE:-}'"
  lane_validate
}

# lane_validate: the constraints that are configuration, not procedure.
lane_validate() {
  [[ ${BENCH_SERVER_REPLICAS:-} =~ ^[0-9]+$ ]] || bench_die "BENCH_SERVER_REPLICAS must be a number"
  if [[ $BENCH_DB_DIALECT == sqlite && $BENCH_SERVER_REPLICAS != 1 ]]; then
    bench_die "the sqlite lane runs exactly one server process (BENCH_SERVER_REPLICAS=$BENCH_SERVER_REPLICAS): a second instance gets its own database and nothing fails"
  fi
  if [[ $BENCH_SERVER_REPLICAS != 1 ]]; then
    bench_die "only one server process is supported in both lanes (BENCH_SERVER_REPLICAS=$BENCH_SERVER_REPLICAS)"
  fi
  case $BENCH_DB_DIALECT in
    sqlite) [[ $BENCH_DB_ROLE == 0 ]] || bench_die "the sqlite lane has no database process (BENCH_DB_ROLE must be 0)" ;;
    postgres) [[ $BENCH_DB_ROLE == 1 ]] || bench_die "the postgres lane runs a database process (BENCH_DB_ROLE must be 1)" ;;
    *) bench_die "unsupported BENCH_DB_DIALECT '$BENCH_DB_DIALECT'" ;;
  esac
  [[ -r $BENCH_SERVER_CONFIG ]] || bench_die "server configuration not readable: $BENCH_SERVER_CONFIG"
  if grep -Eq '^database:' "$BENCH_SERVER_CONFIG"; then
    bench_die "$BENCH_SERVER_CONFIG sets database:, which would make the lanes differ in configuration instead of in the environment the lane tooling provides"
  fi
  if [[ $BENCH_COLLECTOR_ENABLED == 1 ]]; then
    [[ -n $BENCH_COLLECTOR_CMD && -r $BENCH_COLLECTOR_CONFIG ]] ||
      bench_die "BENCH_COLLECTOR_ENABLED=1 needs BENCH_COLLECTOR_CMD and a readable BENCH_COLLECTOR_CONFIG"
  fi
}

# ------------------------------------------------------------------ sizing

lane_argon_mem_kib() {
  local kib
  kib=$(yaml_get "$BENCH_SERVER_CONFIG" password_hasher.hasher.memory)
  # The server's own default when the file does not pin it.
  printf '%s\n' "${kib:-65536}"
}

# lane_mem_mib ROLE: memory.max for the role, in MiB.
lane_mem_mib() {
  case $1 in
    server)
      if [[ -n ${BENCH_MEM_SERVER_MIB:-} ]]; then
        printf '%s\n' "$BENCH_MEM_SERVER_MIB"
      else
        local kib mib
        kib=$(lane_argon_mem_kib)
        mib=$(((kib + 1023) / 1024))
        printf '%s\n' "$((BENCH_SERVER_BASE_MIB + BENCH_LOGIN_CONCURRENCY * mib))"
      fi
      ;;
    db) printf '%s\n' "$BENCH_MEM_DB_MIB" ;;
    loadgen) printf '%s\n' "$BENCH_MEM_LOADGEN_MIB" ;;
    collector) printf '%s\n' "$BENCH_MEM_COLLECTOR_MIB" ;;
    system) printf 'max\n' ;;
    *) bench_die "unknown role '$1'" ;;
  esac
}

lane_role_active() {
  case $1 in
    system | server | loadgen) printf '1\n' ;;
    db) printf '%s\n' "$BENCH_DB_ROLE" ;;
    collector) printf '%s\n' "$BENCH_COLLECTOR_ENABLED" ;;
    *) bench_die "unknown role '$1'" ;;
  esac
}

# The order cores are handed out in. system first: the low-numbered cores are
# where the kernel steers interrupts and where the runner already is.
LANE_ROLES=(system server db collector loadgen)

lane_cores() {
  case $1 in
    system) printf '%s\n' "$BENCH_CORES_SYSTEM" ;;
    server) printf '%s\n' "$BENCH_CORES_SERVER" ;;
    db) printf '%s\n' "$BENCH_CORES_DB" ;;
    collector) printf '%s\n' "$BENCH_CORES_COLLECTOR" ;;
    loadgen) printf '%s\n' "$BENCH_CORES_LOADGEN" ;;
  esac
}

lane_role_specs() {
  local r
  for r in "${LANE_ROLES[@]}"; do
    printf '%s:%s:%s\n' "$r" "$(lane_cores "$r")" "$(lane_role_active "$r")"
  done
}

# ---------------------------------------------------------------- the disk

# disk_info PATH: what PATH lives on, as JSON. The kind is what the policy
# keys on: nvme, ssd, hdd, network, memory, overlay or unknown.
disk_info() {
  local p=$1 src fstype target name sys kind=unknown rot='' model='' dev=''
  mkdir -p "$p"
  src=$(findmnt -n -o SOURCE -T "$p" 2>/dev/null || true)
  fstype=$(findmnt -n -o FSTYPE -T "$p" 2>/dev/null || true)
  target=$(findmnt -n -o TARGET -T "$p" 2>/dev/null || true)
  case $fstype in
    nfs | nfs4 | cifs | smb3 | smbfs | ceph | glusterfs | lustre | afs | 9p | virtiofs | beegfs | gpfs | fuse | fuse.*) kind=network ;;
    tmpfs | ramfs) kind=memory ;;
    overlay) kind=overlay ;;
    *)
      if [[ $src == /dev/* ]]; then
        name=$(basename "$(readlink -f "$src")")
        # Follow device-mapper stacks down to their first member, then up from
        # a partition to the disk that holds it.
        local n=0 member
        while ((n < 8)); do
          n=$((n + 1))
          sys=/sys/class/block/$name
          member=$(find "/sys/block/$name/slaves" -mindepth 1 -maxdepth 1 -printf '%f\n' 2>/dev/null | sort | head -n 1)
          if [[ -n $member ]]; then
            name=$member
            continue
          fi
          if [[ -e $sys/partition ]]; then
            name=$(basename "$(dirname "$(readlink -f "$sys")")")
            continue
          fi
          break
        done
        dev=$name
        rot=$(cat "/sys/block/$name/queue/rotational" 2>/dev/null || true)
        model=$(tr -s ' ' <"/sys/block/$name/device/model" 2>/dev/null | tr -d '\n' || true)
        if [[ $name == nvme* ]]; then
          kind=nvme
        elif [[ $rot == 1 ]]; then
          kind=hdd
        elif [[ $rot == 0 ]]; then
          kind=ssd
        fi
      fi
      ;;
  esac
  jq -nc --arg path "$p" --arg mount "$target" --arg fstype "$fstype" --arg source "$src" \
    --arg device "$dev" --arg kind "$kind" --arg rot "$rot" --arg model "$model" \
    '{path: $path, mount: $mount, fstype: $fstype, source: $source, device: $device,
      kind: $kind, rotational: (if $rot == "" then null else ($rot == "1") end), model: $model}'
}

# disk_check INFO_JSON: refuse a volume that would make the disk, not the
# server, the measurement.
disk_check() {
  local kind
  kind=$(jq -r .kind <<<"$1")
  case $kind in
    network) bench_die "the data directory is on a network filesystem ($(jq -r .fstype <<<"$1")): fsync would be the measurement. Point BENCH_DATA_ROOT at a local volume" ;;
    memory | overlay)
      [[ " $BENCH_ALLOW_DISK_KINDS " == *" $kind "* ]] ||
        bench_die "the data directory is on a $kind filesystem, which says nothing about the disk underneath. Use a local volume, or list '$kind' in BENCH_ALLOW_DISK_KINDS to accept it (the run metadata records it either way)"
      ;;
    unknown) bench_warn "could not identify the disk under $(jq -r .path <<<"$1"); the run metadata records it as unknown" ;;
  esac
}

# ------------------------------------------------------------- PostgreSQL

pg_bindir() {
  if [[ -n ${BENCH_PG_BIN:-} ]]; then
    printf '%s\n' "$BENCH_PG_BIN"
  elif command -v pg_config >/dev/null 2>&1; then
    pg_config --bindir
  else
    printf '\n'
  fi
}

# pg_psql ARGS...: psql against the lane's cluster, as the lane's superuser.
pg_psql() {
  "$LANE_PG_BIN/psql" -X -q -h 127.0.0.1 -p "$BENCH_PG_PORT" -U bench -v ON_ERROR_STOP=1 "$@"
}

# pg_up RUN_DIR DB_CGROUP: a fresh cluster and a fresh database in the
# database cgroup. Sets LANE_PG_DSN and LANE_PG_DB.
pg_up() {
  local run_dir=$1 dbdir=$2 root pgdata
  [[ $(id -u) != 0 ]] || bench_die "PostgreSQL refuses to run as root; run the lane as an unprivileged user"
  LANE_PG_BIN=$(pg_bindir)
  [[ -x $LANE_PG_BIN/initdb && -x $LANE_PG_BIN/postgres && -x $LANE_PG_BIN/psql ]] ||
    bench_die "PostgreSQL binaries not found (set BENCH_PG_BIN to the directory holding initdb, postgres and psql)"
  : "${BENCH_PG_PORT:=55432}"
  root=$BENCH_DATA_ROOT/pg
  pgdata=$root/data
  rm -rf "$root"
  mkdir -p "$pgdata"
  chmod 700 "$pgdata"
  # A fresh cluster per run is the strongest form of "fresh database per
  # run": nothing from an earlier run can be in the shared buffers, the WAL
  # or the catalogs. The database inside it is created fresh as well.
  "$LANE_PG_BIN/initdb" -D "$pgdata" -U bench --auth=trust -E UTF8 --locale=C >"$run_dir/logs/initdb.log" 2>&1 ||
    bench_die "initdb failed (see $run_dir/logs/initdb.log)"
  {
    cat "$(bench_home)/lanes/postgres.conf"
    # Loopback TCP only: no Unix socket (its path length is limited and the
    # server connects over TCP anyway), nothing reachable from outside the pod.
    printf "port = %s\nlisten_addresses = '127.0.0.1'\nunix_socket_directories = ''\n" "$BENCH_PG_PORT"
  } >"$run_dir/postgres.conf"
  printf "include '%s'\n" "$run_dir/postgres.conf" >>"$pgdata/postgresql.conf"
  cg_spawn "$dbdir" "$run_dir/logs/postgres.log" "$run_dir/pids/postgres.pid" "$LANE_PG_BIN/postgres" -D "$pgdata"
  local i
  for ((i = 0; i < 120; i++)); do
    if "$LANE_PG_BIN/pg_isready" -q -h 127.0.0.1 -p "$BENCH_PG_PORT" -U bench; then break; fi
    sleep 0.5
  done
  "$LANE_PG_BIN/pg_isready" -q -h 127.0.0.1 -p "$BENCH_PG_PORT" -U bench ||
    bench_die "PostgreSQL did not accept connections within 60 s (see $run_dir/logs/postgres.log)"
  LANE_PG_DB="nextgen_$(tr -c 'a-z0-9\n' '_' <<<"${BENCH_RUN_ID,,}")"
  pg_psql -d postgres -c "CREATE DATABASE $LANE_PG_DB" >/dev/null
  # shellcheck disable=SC2034  # read by server_up
  LANE_PG_DSN="postgres://bench@127.0.0.1:$BENCH_PG_PORT/$LANE_PG_DB?sslmode=disable"
}

# pg_facts: version and every non-default setting, as JSON. Settings the
# client set for its own session and the compiled-in overrides are not
# configuration and are left out.
pg_facts() {
  local version settings
  version=$(pg_psql -d postgres -Atc 'show server_version')
  settings=$(pg_psql -d postgres -Atc "
    select coalesce(json_agg(json_build_object('name', name, 'setting', setting, 'unit', unit, 'source', source)
                             order by name), '[]'::json)
    from pg_settings where source not in ('default', 'override', 'client', 'session')")
  jq -nc --arg v "$version" --arg db "$LANE_PG_DB" --argjson s "$settings" \
    '{version: $v, database: $db, non_default_settings: $s}'
}

# --------------------------------------------------------------- the server

lane_unset_db_env() {
  local v
  while IFS= read -r v; do printf -- '-u\n%s\n' "$v"; done < <(compgen -e | grep '^NEXTGEN_DATABASE_' || true)
}

# server_up RUN_DIR SERVER_CGROUP DATADIR: start the one server process in its
# cgroup, under an exclusive lock on its data directory, and wait for /healthz.
server_up() {
  local run_dir=$1 sdir=$2 datadir=$3 bin=$BENCH_SERVER_BIN i
  local -a unset_args=() env_args=()
  [[ -x $bin ]] || bench_die "server binary not found or not executable: $bin (build it: go build -o dist/nextgen-server .)"
  # Whatever already answers on the address would satisfy the health check
  # below and the lane would measure it instead of the server it started.
  if curl -fsS --max-time 2 -o /dev/null "http://$BENCH_SERVER_ADDR/healthz" 2>/dev/null; then
    bench_die "something already answers on http://$BENCH_SERVER_ADDR/healthz; a second server process is not allowed. Stop it (bench-lane down) before starting the lane"
  fi
  rm -rf "$datadir"
  mkdir -p "$datadir"
  # The server decides its dialect from the environment it is given. Whatever
  # NEXTGEN_DATABASE_* the job inherited is removed so a stray variable cannot
  # make the SQLite lane something else.
  mapfile -t unset_args < <(lane_unset_db_env)
  env_args=("NEXTGEN_SERVER_DATA_DIR=$datadir" "NEXTGEN_SERVER_ADDRESS=$BENCH_SERVER_ADDR")
  if [[ $BENCH_DB_DIALECT == postgres ]]; then
    env_args+=("NEXTGEN_DATABASE_POSTGRES=$LANE_PG_DSN")
  fi
  # `flock --no-fork -n` takes an exclusive lock on the data directory and
  # then becomes the server, which keeps holding it. A second server pointed at
  # the same directory exits 75 immediately instead of opening the same
  # database. The listen address is a second guard, but only this lock is about
  # the data.
  cg_spawn "$sdir" "$run_dir/logs/server.log" "$run_dir/pids/server.pid" \
    env "${unset_args[@]}" "${env_args[@]}" \
    flock --no-fork -n -E 75 "$datadir" "$bin" -c "$BENCH_SERVER_CONFIG" --migrate
  for ((i = 0; i < 240; i++)); do
    if [[ -s $run_dir/pids/server.pid ]]; then
      # Gone already: do not wait the full timeout for a process that exited.
      kill -0 "$(<"$run_dir/pids/server.pid")" 2>/dev/null || break
      if curl -fsS --max-time 2 -o /dev/null "http://$BENCH_SERVER_ADDR/healthz" 2>/dev/null; then return 0; fi
    fi
    sleep 0.5
  done
  tail -n 20 "$run_dir/logs/server.log" >&2 || true
  bench_die "the server did not answer http://$BENCH_SERVER_ADDR/healthz (log: $run_dir/logs/server.log)"
}

# lane_exe_count DIR BINARY: processes in the cgroup whose executable is BINARY.
lane_exe_count() {
  local pid n=0 want
  want=$(readlink -f "$2")
  for pid in $(cg_pids "$1"); do
    if [[ $(readlink -f "/proc/$pid/exe" 2>/dev/null) == "$want" ]]; then n=$((n + 1)); fi
  done
  printf '%s\n' "$n"
}

# lane_exe_total BINARY: processes anywhere on the host with that executable.
lane_exe_total() {
  local exe n=0 want
  want=$(readlink -f "$1")
  for exe in /proc/[0-9]*/exe; do
    if [[ $(readlink -f "$exe" 2>/dev/null) == "$want" ]]; then n=$((n + 1)); fi
  done
  printf '%s\n' "$n"
}

# lane_boot_marker RUN_DIR: identifies the process lifetimes and the dataset a
# run began against. Captured at the start of a run and rechecked at the end of
# every window; a different digest means a restart or a replaced database, and
# the window is invalid rather than silently re-baselined.
lane_boot_marker() {
  local run_dir=$1 spid sticks ppid pticks dbfile='' dbid=''
  spid=$(cat "$run_dir/pids/server.pid" 2>/dev/null || true)
  sticks=$([[ -n $spid ]] && bench_start_ticks "$spid" || true)
  ppid=$(cat "$run_dir/pids/postgres.pid" 2>/dev/null || true)
  pticks=$([[ -n $ppid ]] && bench_start_ticks "$ppid" || true)
  if [[ $BENCH_DB_DIALECT == sqlite ]]; then
    dbfile=$BENCH_DATA_ROOT/server/zitadel.db
    dbid=$(stat -c '%d:%i' "$dbfile" 2>/dev/null || true)
  fi
  local body digest
  body=$(jq -nc --arg boot "$(cat /proc/sys/kernel/random/boot_id)" \
    --arg spid "$spid" --arg sticks "$sticks" --arg ppid "$ppid" --arg pticks "$pticks" \
    --arg dbfile "$dbfile" --arg dbid "$dbid" \
    '{boot_id: $boot,
      server: {pid: $spid, start_ticks: $sticks},
      postgres: (if $ppid == "" then null else {pid: $ppid, start_ticks: $pticks} end),
      sqlite_file: (if $dbfile == "" then null else {path: $dbfile, dev_inode: $dbid} end)}')
  digest=$(jq -cS . <<<"$body" | sha256sum | awk '{print $1}')
  jq -c --arg d "$digest" '. + {digest: $d}' <<<"$body"
}
