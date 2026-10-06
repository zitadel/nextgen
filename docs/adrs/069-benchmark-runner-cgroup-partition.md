# ADR 069: Benchmark Runner Partition — a cgroup v2 Partition Made by Root in One Ephemeral VM

> **Status:** Proposed
> **Date:** 2026-10-06
> **Context:** [#1097](https://github.com/zitadel/nextgen/issues/1097), the two benchmark lanes of the epic [#1094](https://github.com/zitadel/nextgen/issues/1094). The issue names the way the runner gets its partition as the prerequisite "decided first".
> **Builds on:** [ADR 067](067-benchmark-harness-http-path-ownership.md) (the harness never starts a server; the lane's provisioning tool does), [ADR 028](028-storage-v2-statements-and-dialects.md) (SQLite is the local default and not a production peer)
> **Related:** [#1106](https://github.com/zitadel/nextgen/issues/1106), [#1112](https://github.com/zitadel/nextgen/issues/1112), [runbook](../runbooks/benchmark-lanes.md), [`.github/bench/`](../../.github/bench/)

## Context

A benchmark that runs the database, the API server and the load generator on
one machine measures them against each other unless something holds them apart.
The exploratory smoke that started the epic read `GET /users/{id}` at p95 42 ms
with three other scenarios on the machine and 11 ms alone, with every check
green. The issue asks for a hard partition: one cgroup v2 each for the database,
the API server and the load generator (and the collector of #1106), CPU by
`cpuset` on whole physical cores and memory by `memory.max`.

It left open how the runner gets that partition: cgroup v2 delegation inside a
pod, or one container per role under the kubelet's static CPU manager. The
repository does not need to answer that: its CI already runs on Depot runners
([`ci.yml`](../../.github/workflows/ci.yml)), and a Depot job runs on **its own
ephemeral virtual machine, with root through passwordless `sudo`**. There is no
pod, no kubelet and no self-hosted runner to arrange.

## Decision

**One ephemeral Depot VM per run; the partition is made by root, inside it, from
checked-in scripts.** The lane's cores become a **cpuset partition root**: the
kernel takes them out of every other cgroup on the VM, the runner agent and its
step shells included, so nothing else runs on them. One child cgroup per role
sits inside it, with `cpuset.cpus` and `memory.max` written into cgroup v2
directly. The server, PostgreSQL and the load generator run as the unprivileged
job user; only the scripts are root.

Why this, from what the repository can see and what was measured on the runner:

- **It is the isolation the issue asks for, and it is verified by the kernel.**
  On the VM, writing `+cpuset` to the root's `cgroup.subtree_control` is already
  done by the host's own services; a cgroup with `cpuset.cpus` set and
  `cpuset.cpus.partition = root` reads back `root`, and the root cgroup's
  `cpuset.cpus.effective` drops those cores, so does the job's shell. Delegation
  to an unprivileged user cannot do that last part: it can only keep the roles
  apart from each other, not from the rest of the machine.
- **The server under test is built by the job.** ADR 067 makes the lane's
  provisioning tool start the server; the workflow builds `dist/nextgen-server`
  once and starts it in its cgroup in both lanes. The lanes record its SHA-256
  and `bench-lane compare` fails if they differ.
- **The budget is reviewed with the code.** The core and memory allocation lives
  in [`lanes/common.env`](../../.github/bench/lanes/common.env), one file for both
  lanes.
- **What is recorded is what is enforced.** Every window snapshots
  `cpuset.cpus.effective`, `memory.max`, `memory.events` and `cpu.stat` from the
  cgroup the process is in.
- **One VM per run, both lanes on it.** A Depot VM is ephemeral and belongs to
  the job, so lanes run one after the other on the same hardware, which makes
  them comparable (`compare` checks CPU model, kernel, machine type and
  allocation) and means nothing outlives the job, even if a teardown fails.

### What the Depot runner exposes

Read from real runs of the workflow, recorded in every lane's run metadata
(`host.platform`):

- Ubuntu 24.04, a recent kernel (6.12 to 6.17), cgroup v2 mounted, the `cpuset`,
  `cpu`, `memory` and `pids` controllers available and enabled for children at
  the root, `sudo` without a password.
- **The label does not pin the platform.** `depot-ubuntu-24.04-16` was an AWS
  `m8i.4xlarge` (Intel Xeon 6975P-C, 8 cores of 2 threads, SMT siblings exposed
  in `thread_siblings_list`, EBS root volume) on some runs and a Cloud Hypervisor
  VM on an AMD EPYC 9R45 (16 cores of 1 thread, no SMT visible, paravirtual
  disks) on others; the other sizes seen are an `m8i.8xlarge` (32 vCPU) and an
  `m8a.16xlarge` (64 vCPU, no SMT). The scripts do not assume a platform: they
  read the topology and record what they found.
- **The disk is never a local one the guest can tell is local.** The root volume
  is an EBS volume (a network service behind an NVMe interface) or a paravirtual
  disk. The data directory therefore sits on a volume whose `fsync` is partly the
  provider's. The lane records the kind (`network-block`, `virtual-disk`) and
  refuses it unless the workflow lists it in `BENCH_ALLOW_DISK_KINDS`; it does,
  explicitly, for both lanes alike.
- Sibling threads are exposed on the AWS Intel sizes only. Where the guest sees one
  thread per core, "whole physical cores" is the guest's view; whether two vCPUs
  share a physical core on the host is not visible. The run metadata says which
  case it was (`partition.core_isolation`), and `BENCH_REQUIRE_SMT=1` makes the
  lane refuse to start on such a VM.

### Sizes

`depot-ubuntu-24.04-32` for measurement: on the AWS variant that is 16 cores of
2 threads and 128 GiB, of which 14 cores are given out (system 2, server 4,
database 3, collector 1, load generator 4) and the runner keeps what is left.
`depot-ubuntu-24.04-16` for the pull request proof, which has to give out every
core (system 1, server 2, database 2, collector 1, load generator 2) and runs for
a couple of minutes; it needs no more. The 8 vCPU size is too small to partition
five roles, and the 64 vCPU size is a different CPU family with no SMT.

### How the partition is made

- **CPU by `cpuset`, never by quota.** `cpu.max` stays `max` and `cpu.weight`
  stays default. A quota still lets two processes share a core and adds
  throttling stalls that read as latency. (The validity check proves the point
  from the other side: it puts a quota on the server on purpose and requires the
  window to be invalid.)
- **Whole cores in the guest's topology.** Cores are taken from
  `thread_siblings_list`; both siblings of a core always belong to one role.
- **Exclusive against everything.** The partition root's cores are removed from
  every other cgroup; the roles' cpusets inside it are disjoint. The runner,
  `systemd` and the job's tooling keep the rest. Cores no role owns inside the
  partition stay idle.
- **Both lanes carve the same cores.** Roles are carved in a fixed order whether
  they run or not, so the SQLite lane keeps the database's cores reserved and idle
  rather than giving them to the server. The server and the load generator get
  identical cores and memory in both lanes.
- **Memory by `memory.max`, sized for the password path.** The API server's limit
  is `BENCH_SERVER_BASE_MIB + BENCH_LOGIN_CONCURRENCY × argon2id memory`, the
  memory read from the pinned `password_hasher.hasher.memory` (64 MiB). Swap is
  off in the roles' cgroups and the server's and database's cgroups die as a unit
  (`memory.oom.group`), so memory pressure shows as an OOM event, which
  invalidates the window, and not as latency.
- **Delegated mode** (no root) runs the same scripts inside a cgroup delegated to
  the user, with the runner in a `system` leaf. It is for development on a
  machine without sudo and cannot give exclusivity from the rest of the machine.

### Limits stated next to every result

The partition does not hold these apart, and every run's metadata lists them
(`not_partitioned`): the last-level cache, memory bandwidth and controller
queues, interrupt handling, power and thermal headroom shared by the cores, and
**whatever runs on the host beneath the virtual machine** (hypervisor scheduling
and the VM's neighbours, neither visible nor controllable from inside). vCPUs and
sibling threads are what the hypervisor chooses to show. File pages the server
reads are charged to its cgroup, so the SQLite lane's page cache counts against
the server's limit. The host has swap that the roles' cgroups do not use.

## Alternatives considered

- **A pod, with cgroup v2 delegation or one container per role under the static
  CPU manager** (the options the issue named). Not applicable: there is no pod
  on a Depot runner. Delegation without root is kept as the development mode.
- **A self-hosted runner on a dedicated machine.** Would give a fixed platform,
  SMT visibility and a local disk, and costs a machine to run and secure. This is
  what to reach for if the variability above makes the numbers unusable; the
  scripts need only a Linux host with root and cgroup v2.
- **`cpu.max` quotas or `cpu.weight`.** Rejected by the issue and kept rejected.
- **`systemd-run --slice` with `AllowedCPUs` and `MemoryMax`.** The same cgroup
  interface through a manager the tooling does not otherwise need; it writes
  cgroupfs directly.

## Consequences

- The workflow runs the whole proof (both lanes: partition, isolation, single
  server, validity rules, teardown) on every same-repo pull request that touches
  the lane tooling, and the measured windows only on `workflow_dispatch` or
  `workflow_call`, once the harness is on `main`. Fork pull requests never reach a
  Depot runner.
- Teardown is the job's responsibility and idempotent: it kills the roles'
  processes, removes the cgroups, which returns the cores to every other cgroup,
  and checks that nothing is left. It runs from `if: always()`, so also after a
  cancelled job; a VM that dies outright takes everything with it.
- Numbers from different runs are comparable only if their platforms are: a run
  records its platform, and two lanes are compared only if they ran on the same
  VM (`compare`).
- The data directory is on a network or virtual volume. A lane's `fsync` cost is
  the volume's, the same in both lanes of one VM, and not a property of the
  database. That is a limit of the platform, stated in the metadata.
