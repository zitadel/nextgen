# Benchmark lanes

How the two benchmark lanes are provisioned, partitioned, measured and torn down
on the dedicated runner. The decision behind it is
[ADR 069](../adrs/069-benchmark-runner-cgroup-partition.md); the epic is
[#1094](https://github.com/zitadel/nextgen/issues/1094) and this is
[#1097](https://github.com/zitadel/nextgen/issues/1097). The k6 harness that does
the measuring ([ADR 067](../adrs/067-benchmark-harness-http-path-ownership.md),
`tools/bench`) never starts or stops a server; everything here is the provisioning
tool it is pointed at.

| Path | What |
| --- | --- |
| [`.github/workflows/bench-lanes.yml`](../../.github/workflows/bench-lanes.yml) | `workflow_dispatch` / `workflow_call` on the dedicated runner; a self-test job on pull requests |
| [`.github/bench/lanes/`](../../.github/bench/lanes/) | `common.env` (hardware budget, sizing, collector, disk policy), `sqlite.env`, `postgres.env`, `postgres.conf` |
| [`.github/bench/server.yaml`](../../.github/bench/server.yaml) | the one server configuration of both lanes |
| [`.github/bench/bin/`](../../.github/bench/bin/) | `bench-lane`, `bench-partition`, `bench-window`, `bench-measure`, `bench-verify-isolation`, `job-completed-hook` |
| [`.github/bench/test/run.sh`](../../.github/bench/test/run.sh) | unprivileged tests against a stand-in for cgroupfs |

## What a lane is

Two lanes of the same server build and the same server configuration, differing in
the database alone.

| | SQLite lane | PostgreSQL lane |
| --- | --- | --- |
| Database | SQLite at `<data dir>/zitadel.db`, selected by the server's fallback (no dialect configured) | a fresh PostgreSQL cluster and database per run, in its own cgroup |
| Server | exactly one process | exactly one process; `NEXTGEN_DATABASE_POSTGRES` is the only difference in its environment |
| Data | a directory on a local volume; disk kind recorded | PostgreSQL's data directory on a local volume; disk kind recorded |
| Recorded | boot marker, disk kind | boot marker, disk kind, PostgreSQL version, every non-default setting |

The server's address, data directory and database come from the environment
`bench-lane` gives it; [`server.yaml`](../../.github/bench/server.yaml) has no
`database:` key, and `bench-lane` refuses a configuration that has one. It is
deliberately not called `nextgen.yaml`, which the root `.gitignore` ignores.

## The partition

One cgroup v2 each for the **server**, the **load generator**, the **database**
(PostgreSQL lane) and the **collector** (when it runs; #1106), plus a **system**
leaf that holds everything else: the runner agent, the step shells and these
scripts. Written directly into cgroupfs below the cgroup the job runs in.

- **CPU by `cpuset`, whole physical cores.** Both SMT siblings of a core always
  belong to one role; a core with a sibling outside the available set is not used.
  There is no `cpu.max` quota and no `cpu.weight`: a quota still lets two processes
  share a core and adds throttling stalls that read as latency.
- **Same cores in both lanes.** Roles are carved in a fixed order (system, server,
  database, collector, load generator) whether or not they run. The SQLite lane
  keeps the database's cores reserved and idle, so the server and the load
  generator get the same cores and memory in both.
- **Memory by `memory.max`.** The server's limit is
  `BENCH_SERVER_BASE_MIB + BENCH_LOGIN_CONCURRENCY × argon2id memory` with the memory
  read from `password_hasher.hasher.memory` in `server.yaml` (64 MiB), so login
  concurrency is bounded by that number. With the defaults, `1024 + 32 × 64 = 3072`
  MiB. Swap is off in every role with a memory limit; the server's and the database's cgroups die as a
  unit on OOM.
- **The sum of the limits must fit the host** or `bench-partition` refuses.

The figures in [`lanes/common.env`](../../.github/bench/lanes/common.env) are
**placeholders**: the runner's hardware budget is not known to this repository.

### Not partitioned

The partition does not hold these apart, and every run's metadata lists them under
`not_partitioned`; state them next to every result: the **last-level cache**,
**memory bandwidth and controller queues**, **interrupt handling**, **power and
thermal headroom** shared by the cores, and, unless the node is dedicated,
**other pods**. Page cache the server reads is charged to its cgroup.

## Windows and validity

`bench-window begin|end|run` snapshots, for every role, at the start and end of a
measurement window: `cpuset.cpus.effective`, `memory.max`, `memory.events`,
`cpu.stat`, and also the boot marker and the number of server processes.
`bench-measure` runs the harness once per scenario and VU count, each in its own
window and in the load generator's cgroup, so a window is one `sweep` invocation
(it includes k6's start-up; that is conservative, not generous).

A window is **invalid** when, between begin and end:

| Condition | Why |
| --- | --- |
| `cpuset.cpus.effective` of any role changed, or differs from the plan | the cores were not the ones planned |
| `memory.max` of any role changed, or differs from the plan | the budget moved |
| `oom`, `oom_kill` or `oom_group_kill` rose in any cgroup | a killed process is a different run |
| `nr_throttled` or `throttled_usec` rose in the **server's** or the **database's** cgroup | throttling stalls read as server latency |
| the boot marker changed | the server or the database restarted, or the database was replaced; the dataset is not the one the run began with |
| the server process count (in its cgroup, and on the host) is not the replica count | a second server |
| the cpuset partition was not applied | the cores were not exclusive |

`memory.events` `max`/`high` rising in the server's or database's cgroup is
reported as a warning: it hit its limit and reclaimed. Records are written to
`<run dir>/windows/<name>/{start,end,verdict}.json`; `bench-window end` exits 3 for
an invalid window and `bench-measure` finishes every window before failing the
job, so one bad window does not hide the others.

## SQLite lane: one server, enforced by configuration

With two server processes SQLite is not degraded, it is wrong: each instance gets
its own database, the load splits across datasets that diverge, and no request
fails. The lane enforces one process in five places, none of them a runbook step:

1. `lanes/sqlite.env` pins `BENCH_SERVER_REPLICAS=1`, `lane_validate` refuses any
   other value, and the lane file is sourced last so the environment cannot
   change it.
2. The server runs as `flock --no-fork -n -E 75 <data dir> <server>`: it holds an
   exclusive lock on its data directory for its whole life, and a second server
   pointed at the same directory exits 75 instead of opening the same database.
3. `bench-lane up` refuses to start if anything already answers `/healthz` on the
   address.
4. The server processes in its cgroup and on the host are counted at the start and
   end of every window.
5. Any `NEXTGEN_DATABASE_*` variable the job inherited is removed from the server's
   environment, so the lane cannot silently be PostgreSQL.

The dialect is then **observed**, not assumed: the server must hold `zitadel.db`
open (SQLite), or the fresh database must contain the migrated tables
(PostgreSQL). The **boot marker** (boot id, server and database process start
times, the SQLite file's device and inode) is captured at the start of the run and
rechecked at the start and end of every window.

The data directory must be on a local volume; the disk kind (`nvme`, `ssd`, `hdd`,
`network`, `memory`, `overlay`, `unknown`), filesystem, device and model are
recorded. A network filesystem is refused; `tmpfs` and `overlay` are refused unless
named in `BENCH_ALLOW_DISK_KINDS`, because neither says what disk is underneath.

## PostgreSQL lane

The pod needs PostgreSQL binaries **with the contrib extensions** the migrations
use (`btree_gin`, `pgcrypto`), `psql` and `pg_isready`, and the job must run as an
unprivileged user (PostgreSQL refuses root). Set `BENCH_PG_BIN` if they are not on
the path. The cluster is created per run on the lane's local volume with
`initdb`, configured by [`postgres.conf`](../../.github/bench/lanes/postgres.conf),
listens on loopback TCP only, and is stopped and deleted at teardown. The run
metadata records `database.postgres.version` and every setting `pg_settings`
reports from anywhere but the compiled-in default, the client session and
internal overrides.

## The run record

`bench-lane up` writes `<run dir>/run-metadata.json` (schema `bench-lane-run/v1`):
commit and image tag; kernel, CPU model, node, the machine type and node isolation
the workflow **declared** (marked `declared` or `unknown`, since the repository
cannot observe them); the full partition (role, cgroup path, cores, cpus, memory);
the limits not partitioned; the server binary and configuration SHA-256 and the
memory budget; the collector's configuration SHA-256; the database, its disk, the
observed dialect, and for PostgreSQL its version and settings; the boot marker;
and `declare`, the facts in the form the harness takes.

The doctor command (`k6 x nextgen doctor`) is in the harness's wave-2 layer
([#1415](https://github.com/zitadel/nextgen/pull/1415)) and is not on `main`. It
takes `--declare name=value` for what the server does not report, so the lane hands
it exactly that:

```sh
mapfile -t declared < <(.github/bench/bin/bench-lane declare-args)
tools/bench/dist/k6 x nextgen doctor --base http://127.0.0.1:8080 "${declared[@]}"
```

`dialect`, `replicas`, `log_level`, `image_tag` and the `cgroup_*` allocation facts
(`cgroup_server_cpus`, `cgroup_server_memory_max`, `cgroup_loadgen_cpus`, and for
PostgreSQL `cgroup_db_cpus`, …) are all in `declare`. The workflow runs the doctor
when the harness has it and prints the same facts when it does not.
`bench-lane compare A B` checks two runs differ in the database only: the same
server build, server configuration, collector, hardware and allocation.

## Demonstrating the partition

```sh
.github/bench/bin/bench-verify-isolation --seconds 8 --out isolation.json
```

Inside one window it runs twice as many busy loops in the load generator's cgroup
as it has CPUs, and one in the server's, then checks that the load generator
**saturated** its cores, that every busy loop **ran only on its own cgroup's
CPUs** and the two sets are disjoint (placement), that the server's cgroup
received a full core (**served**), and that the window verdict is clean
(**unchanged**: the server's `cpuset.cpus.effective` and `memory.max` did not
move, `nr_throttled` and `throttled_usec` did not rise, no OOM). Exit 0 passed,
1 failed, 2 **incomplete**: the cpuset controller is not available, so placement
cannot be demonstrated and the script says so instead of passing. The workflow
runs it on every lane before measuring and fails the lane unless it passed.

## Running a lane

On the runner: dispatch **bench-lanes** (Actions → bench-lanes → Run workflow),
choosing the lanes, scenarios, VU counts and duration. The job queues on
`BENCH_RUNNER_LABELS`, one lane at a time (`max-parallel: 1` plus the
`bench-dedicated-runner` concurrency group, never cancelled in flight), builds the
server and the harness, then:

1. `bench-partition preflight` (first step: the pod can host the partition)
2. `bench-lane up <lane>`: partition, database (PostgreSQL), the one server,
   dialect check, boot marker, `run-metadata.json`
3. `bench-verify-isolation`
4. provision the fixture through the API, from the load generator's cgroup; the
   target file carries the project secret and stays out of the uploaded run record
5. the doctor report (when the harness has it)
6. `bench-measure`: one window per scenario and VU count
7. `bench-lane down` (always), then upload the run directory
8. the **compare** job: both lanes differ in the database only

On a plain Linux box, without privileges, for development (the partition is then
memory-only and every window is invalid, which the record says):

```sh
go build -o dist/nextgen-server .
systemd-run --user --scope -p Delegate=yes env \
  BENCH_ALLOW_NO_CPUSET=1 BENCH_ALLOW_DISK_KINDS="memory overlay" \
  BENCH_CORES_SERVER=2 BENCH_CORES_LOADGEN=2 BENCH_MEM_SERVER_MIB=2048 \
  bash -c '.github/bench/bin/bench-lane up sqlite && .github/bench/bin/bench-verify-isolation; .github/bench/bin/bench-lane down'
```

`.github/bench/test/run.sh` runs the tooling's tests with no privileges.

## Teardown

`bench-lane down` stops the collector, the server (SIGTERM, then the cgroup is
killed), PostgreSQL (fast shutdown), kills what is left in each role cgroup,
removes the cgroups, turns the controllers it enabled back off, moves the runner
back to the cgroup it came from, and deletes the lane's data directories
(`BENCH_KEEP_DATA=1` keeps them). It is **idempotent**, finds what to undo from
state it wrote under `BENCH_STATE_DIR` rather than from the shell that started the
lane, and steps itself and its parent shells out of any role cgroup first, so it
works when started from inside one.

| How the job ended | What tears the lane down |
| --- | --- |
| passed or failed | the workflow's `if: always()` step |
| cancelled | the same step: `always()` runs after a cancellation request |
| the runner process or pod was killed before that step ran | `bench-lane up` on the next job removes the leftover lane first (`a previous lane was not torn down`); and `bin/job-completed-hook`, registered as `ACTIONS_RUNNER_HOOK_JOB_COMPLETED` on the pod (**needs the runner**), runs it when the runner ends a job |

By hand, on the pod: `.github/bench/bin/bench-lane down`; to remove only the
cgroups, `.github/bench/bin/bench-partition down`.

## What needs the runner

This repository cannot see the runner. Everything below is implemented in the
repository and not yet exercised on one; none of it is claimed by the pull request
that added the tooling.

- [ ] Runner pool exists; set `BENCH_RUNNER_LABELS` (JSON array).
- [ ] The runner container has a **writable cgroup2 mount** with the `cpuset`,
      `cpu` and `memory` controllers delegated (`bench-partition preflight` passes).
- [ ] The pod is Guaranteed QoS with whole-CPU requests under the static CPU
      manager policy, on a node nothing else is scheduled to; set
      `BENCH_NODE_DEDICATED=true`. Otherwise the budget is a limit and the metadata
      says so.
- [ ] Machine type known; set `BENCH_MACHINE_TYPE` and size
      `BENCH_CORES_*`/`BENCH_MEM_*` in `lanes/common.env` to it.
- [ ] A local volume for `BENCH_DATA_ROOT`; the recorded disk kind is as expected.
- [ ] PostgreSQL with contrib on the pod; the job user can run it.
- [ ] `bench-verify-isolation` **passes** (not "incomplete") on the real cpuset.
- [ ] `bin/job-completed-hook` registered as the runner's job-completed hook.
- [ ] The collector (#1106) merged; set `BENCH_COLLECTOR_*` so both lanes run it.
- [ ] A first dispatched run of both lanes, and the compare job green.
