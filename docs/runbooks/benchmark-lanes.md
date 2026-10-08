# Benchmark lanes

How the two benchmark lanes are provisioned, partitioned, measured and torn down
on a Depot runner (an ephemeral VM per job, root through `sudo`). The decision behind it is
[ADR 069](../adrs/069-benchmark-runner-cgroup-partition.md); the epic is
[#1094](https://github.com/zitadel/nextgen/issues/1094) and this is
[#1097](https://github.com/zitadel/nextgen/issues/1097). The k6 harness that does
the measuring ([ADR 067](../adrs/067-benchmark-harness-http-path-ownership.md),
`tools/bench`) never starts or stops a server; everything here is the provisioning
tool it is pointed at.

| Path | What |
| --- | --- |
| [`.github/workflows/bench-lanes.yml`](../../.github/workflows/bench-lanes.yml) | the proof on same-repo pull requests (16 vCPU), the measured windows on `workflow_dispatch` / `workflow_call` (32 vCPU), a self-test job |
| [`.github/actions/bench-lane/`](../../.github/actions/bench-lane/action.yml) | one lane's sequence: up, single-server check, isolation check, measure, validity controls, teardown |
| [`.github/bench/lanes/`](../../.github/bench/lanes/) | `common.env` (hardware budget, sizing, collector, disk policy), `sqlite.env`, `postgres.env`, `postgres.conf` |
| [`.github/bench/server.yaml`](../../.github/bench/server.yaml) | the one server configuration of both lanes |
| [`.github/bench/bin/`](../../.github/bench/bin/) | `bench-lane`, `bench-partition`, `bench-window`, `bench-measure`, `bench-verify-isolation`, `bench-summary` |
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

On the VM the scripts run as root (they elevate themselves with `sudo` when
`BENCH_PARTITION_MODE=host`) and make the lane's cores a **cpuset partition
root**: the kernel takes them out of every other cgroup, the runner agent and
the job's shells included, so nothing else on the VM runs on them. Inside it,
one cgroup v2 each for the **server**, the **load generator**, the **database**
(PostgreSQL lane) and the **collector** (when it runs; #1106). The server, the
database and the load generator run as the unprivileged job user.

- **CPU by `cpuset`, whole cores of the guest's topology.** Both SMT siblings of a
  core always belong to one role. There is no `cpu.max` quota and no `cpu.weight`:
  a quota still lets two processes share a core and adds throttling stalls that
  read as latency.
- **Same cores in both lanes.** Roles are carved in a fixed order (system, server,
  database, collector, load generator) whether or not they run. The SQLite lane
  keeps the database's cores reserved and idle, so the server and the load
  generator get the same cores and memory in both. "system" is everything outside
  the partition: whatever cores the roles do not take.
- **Memory by `memory.max`.** The server's limit is
  `BENCH_SERVER_BASE_MIB + BENCH_LOGIN_CONCURRENCY × argon2id memory` with the memory
  read from `password_hasher.hasher.memory` in `server.yaml` (64 MiB), so login
  concurrency is bounded by that number. With the defaults, `1024 + 32 × 64 = 3072`
  MiB. Swap is off in every role; the server's and the database's cgroups die as a
  unit on OOM.
- **The sum of the limits must fit the host** or `bench-partition` refuses.

Sizing is in [`lanes/common.env`](../../.github/bench/lanes/common.env), for the
32 vCPU size (14 of 16 cores given out); the pull request proof overrides the core
counts for the 16 vCPU size (8 cores, all given out).

### What the Depot runner exposes

The workflow logs it before anything depends on it, and every lane records it in
`run-metadata.json` (`host.platform`, `host.threads_per_core`):

- Ubuntu 24.04, cgroup v2, controllers `cpuset cpu memory pids` available and
  enabled at the root, passwordless `sudo`.
- **The runner label does not pin the platform.** `depot-ubuntu-24.04-16` has been
  an AWS `m8i.4xlarge` (Intel, SMT siblings exposed, EBS volume) and a Cloud
  Hypervisor VM on an AMD EPYC (no SMT visible, paravirtual disks). The 32 vCPU
  size has been an `m8i.8xlarge`. Compare runs only if their recorded platforms
  match; the two lanes of one run share a VM and are always comparable.
- **No disk the guest can tell is local.** EBS or a paravirtual disk. The lane
  refuses these kinds unless `BENCH_ALLOW_DISK_KINDS` lists them, which the
  workflow does for both lanes alike, and records the kind.
- Where the guest sees one thread per core, whether two vCPUs share a physical
  core on the host is invisible (`partition.core_isolation` says so);
  `BENCH_REQUIRE_SMT=1` makes the lane refuse such a VM.

### Not partitioned

The partition does not hold these apart, and every run's metadata lists them under
`not_partitioned`; state them next to every result: the **last-level cache**,
**memory bandwidth and controller queues**, **interrupt handling**, **power and
thermal headroom** shared by the cores, and **whatever runs on the host beneath
the virtual machine** (hypervisor scheduling, the VM's neighbours). Page cache the server reads is charged to its cgroup.

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
recorded. A network filesystem is refused; `tmpfs`, `overlay`, `network-block` (a
cloud block volume such as EBS) and `virtual-disk` are refused unless named in
`BENCH_ALLOW_DISK_KINDS`, because none of them is a local disk the machine owns.
The Depot workflow names the last two for both lanes, since that is all the VM has.

## PostgreSQL lane

The VM needs PostgreSQL binaries **with the contrib extensions** the migrations
use (`btree_gin`, `pgcrypto`), `psql` and `pg_isready` (the Depot image has PostgreSQL 16; the workflow installs
it if it is missing and stops the packaged service). PostgreSQL refuses root, so it
runs as the job user like the server. Set `BENCH_PG_BIN` for another location. The
cluster is created per run on the lane's volume with
`initdb`, configured by [`postgres.conf`](../../.github/bench/lanes/postgres.conf),
listens on loopback TCP only, and is stopped and deleted at teardown. The run
metadata records `database.postgres.version` and every setting `pg_settings`
reports from anywhere but the compiled-in default, the client session and
internal overrides.

## The run record

`bench-lane up` writes `<run dir>/run-metadata.json` (schema `bench-lane-run/v1`):
commit and image tag; kernel, CPU model, threads per core, and the platform as the
VM reports it (virtualization, hypervisor, instance type) with its isolation note;
the full partition (mode, role, cgroup path, cores, cpus, memory) and how far
"whole cores" can be verified; the limits not partitioned; the server binary and
configuration SHA-256 and the memory budget; the collector's configuration SHA-256;
the database, its disk, the observed dialect, and for PostgreSQL its version and
settings; the boot marker; and `declare`, the facts in the `--declare name=value`
form the harness takes.

The harness's `k6 x nextgen doctor` ([#1105](https://github.com/zitadel/nextgen/issues/1105))
reads the run's dialect and cgroup allocation from this file; it is not part of this
change. `bench-lane declare-args` prints exactly what it takes:

```sh
mapfile -t declared < <(.github/bench/bin/bench-lane declare-args)   # --declare=dialect=sqlite ...
```

`dialect`, `replicas`, `log_level`, `image_tag` and the `cgroup_*` allocation facts
(`cgroup_server_cpus`, `cgroup_server_memory_max`, `cgroup_loadgen_cpus`, and for
PostgreSQL `cgroup_db_cpus`, ...) are all in `declare`. `bench-measure` passes them to
`sweep` when it accepts `--declare`. `bench-lane compare A B` checks two runs differ in
the database only: the same server build, server configuration, collector, hardware
and allocation. `bench-summary RUN_DIR` renders a run as markdown; the workflow
writes it to the job summary.

## Demonstrating the partition

```sh
.github/bench/bin/bench-verify-isolation --seconds 8 --out isolation.json [--negative-controls]
```

Inside one window it runs twice as many busy loops in the load generator's cgroup
as it has CPUs, and one in the server's, then checks that the load generator
**saturated** its cores, that every busy loop **ran only on its own cgroup's
CPUs** and the two sets are disjoint (**placement**), that the server's cgroup
received a full core (**served**), that the processes outside the partition, this
one among them, can not run on any of its cores (**outside**), and that the window
verdict is clean (**unchanged**: the server's `cpuset.cpus.effective` and
`memory.max` did not move, `nr_throttled` and `throttled_usec` did not rise, no OOM).
Exit 0 passed, 1 failed, 2 **incomplete**: the cpuset controller is not available,
so placement cannot be demonstrated and the script says so instead of passing.

`--negative-controls` then proves the validity rules fire on the kernel at hand: a
CPU quota (the one thing the partition never sets) is put on the server's cgroup for
a few seconds and the window must be invalid for throttling; and, with a lane up, the
server is restarted inside a window and the boot marker must invalidate it. After the
restart the lane is not the one the run began against, so the workflow does it last.

## Running a lane

**Pull requests** that touch `.github/bench/**`, the `bench-lane` action or the
workflow run the proof on a `depot-ubuntu-24.04-16` VM: both lanes, one after the
other on the same VM, without `tools/bench`. Fork pull requests never reach a Depot
runner. **`workflow_dispatch`** (Actions → bench-lanes → Run workflow) and
**`workflow_call`** run the same on `depot-ubuntu-24.04-32` and, once the harness
(`tools/bench`, #1413) is on `main`, provision the fixtures and run the measured
windows as well; until then those steps are skipped with a notice. Each lane:

1. `bench-partition preflight` (once, first: the VM can host the partition)
2. `bench-lane up <lane>`: partition, database (PostgreSQL), the one server, dialect
   check, boot marker, `run-metadata.json`
3. `bench-lane assert-single-server`
4. `bench-verify-isolation`, which must pass
5. provision the fixture through the API from the load generator's cgroup; the target
   file carries the project secret and stays out of the uploaded run record
6. `bench-measure`: one window per scenario and VU count
7. `bench-verify-isolation --negative-controls`
8. `bench-lane down` and `bench-lane assert-clean` (always), then the job summary

then `bench-lane compare` of the two lanes, a final `assert-clean`, and the run
records are uploaded.

On a plain Linux box, without privileges, for development (the partition is then
memory-only, no cores are exclusive and every window is invalid, which the record
says):

```sh
go build -o dist/nextgen-server .
systemd-run --user --scope -p Delegate=yes env \
  BENCH_ALLOW_NO_CPUSET=1 BENCH_ALLOW_DISK_KINDS="memory overlay" \
  BENCH_CORES_SERVER=2 BENCH_CORES_LOADGEN=2 BENCH_MEM_SERVER_MIB=2048 \
  bash -c '.github/bench/bin/bench-lane up sqlite && .github/bench/bin/bench-verify-isolation; .github/bench/bin/bench-lane down'
```

With sudo, `BENCH_PARTITION_MODE=host` does what the workflow does. `.github/bench/test/run.sh`
runs the tooling's tests with no privileges.

## Teardown

`bench-lane down` stops the collector, the server (SIGTERM, then the cgroup is
killed), PostgreSQL (fast shutdown), kills what is left in each role cgroup, removes
the cgroups (which returns the cores to every other cgroup), and deletes the lane's
data directories (`BENCH_KEEP_DATA=1` keeps them). It is **idempotent**, finds what
to undo from state it wrote under `BENCH_STATE_DIR` rather than from the shell that
started the lane, and steps itself and its parent shells out of any role cgroup
first, so it works when started from inside one. `bench-lane assert-clean` then
fails unless nothing is left: no lane or partition state, no cgroup, no server or
PostgreSQL process, and the host's `cpuset.cpus.effective` back to every online CPU.

| How the job ended | What tears the lane down |
| --- | --- |
| passed or failed | the action's `if: always()` step |
| cancelled | the same step: `always()` runs after a cancellation request |
| the VM died | nothing needs to: the VM is ephemeral and takes the lane with it |

By hand, on a machine where a lane was left: `.github/bench/bin/bench-lane down`;
to remove only the cgroups, `.github/bench/bin/bench-partition down`.
`bench-lane up` also removes a lane a killed run left behind
(`a previous lane was not torn down`).
