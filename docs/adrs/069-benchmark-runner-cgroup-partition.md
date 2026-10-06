# ADR 069: Benchmark Runner Partition — cgroup v2 Delegation Inside One Pod

> **Status:** Proposed
> **Date:** 2026-10-06
> **Context:** [#1097](https://github.com/zitadel/nextgen/issues/1097), the two benchmark lanes of the epic [#1094](https://github.com/zitadel/nextgen/issues/1094). The issue names this as the prerequisite "decided first"; the repository cannot see the runner infrastructure, so this ADR is Proposed until the runner owner confirms the preconditions below.
> **Builds on:** [ADR 067](067-benchmark-harness-http-path-ownership.md) (the harness never starts a server; the lane's provisioning tool does), [ADR 028](028-storage-v2-statements-and-dialects.md) (SQLite is the local default and not a production peer)
> **Related:** [#1106](https://github.com/zitadel/nextgen/issues/1106), [#1112](https://github.com/zitadel/nextgen/issues/1112), [runbook](../runbooks/benchmark-lanes.md), [`.github/bench/`](../../.github/bench/)

## Context

A benchmark that runs the database, the API server and the load generator on one
machine measures them against each other unless something holds them apart. The
exploratory smoke that started the epic read `GET /users/{id}` at p95 42 ms with
three other scenarios on the machine and 11 ms alone, with every check green.
The issue asks for a hard partition: one cgroup v2 each for the database, the API
server and the load generator (and the collector of #1106), CPU by `cpuset` on
whole physical cores and memory by `memory.max`.

It leaves one thing open: **how the runner pod gets that partition.**

1. **cgroup v2 delegation inside the pod.** One pod, one runner container; the
   job creates the cgroups itself below the cgroup the container was delegated
   and puts each process in its own.
2. **One container per role** with Guaranteed QoS under the kubelet's static CPU
   manager policy. The kubelet assigns each container exclusive cores and the
   memory limit; the roles are sidecar or service containers of the runner pod.

## Decision

**Delegation inside the pod (option 1), on top of a Guaranteed-QoS pod where the
cluster allows it.** The partition is made by the job, from checked-in
configuration, with `cpuset.cpus` and `memory.max` written into cgroup v2
directly.

Why this one, from what the repository can see:

- **The server under test is built by the job, from the commit under test.**
  ADR 067 makes the lane's provisioning tool start the server; on GitHub Actions
  that is the workflow, whose steps all run in the one runner container. With a
  container per role the server and the database become containers started
  outside the steps, so the binary under test has to be packaged as an image per
  run, and "the same server build in both lanes" becomes a property of two image
  digests instead of one file. With delegation the job builds `dist/nextgen-server`
  once and starts it in its cgroup; the lanes record its SHA-256, and
  `bench-lane compare` fails if two lanes differ in it.
- **The budget is reviewed with the code.** The core and memory allocation lives
  in [`lanes/common.env`](../../.github/bench/lanes/common.env), one file for both
  lanes, so changing it is a pull request and the two lanes cannot be sized
  differently by accident. Under option 2 the budget is a pod spec in whatever
  repository the cluster is managed from.
- **What is recorded is what is enforced.** Every window snapshots
  `cpuset.cpus.effective`, `memory.max`, `memory.events` and `cpu.stat` read from
  the cgroup the process is in. Under option 2 the numbers would come from the pod
  spec, and the kubelet's actual assignment would still have to be read back from
  each container's cgroup.
- **The SQLite lane's single-server rule is one lock and one count.** The server
  runs under an exclusive lock on its data directory and the cgroup is counted
  (`cgroup.procs`) at the start and end of every window. With roles in separate
  containers, "one server" is a property of the pod spec only.
- **Nothing in the design depends on the cluster's kubelet configuration.** Option
  2 needs `cpuManagerPolicy: static` on the node (ideally with the
  `full-pcpus-only` option so a container never gets half a core), integer CPU
  requests equal to limits for every container, and a node pool configured for it.
  None of that is visible or verifiable from this repository.

What option 2 does better, and why this does not rule it out: the static policy
removes a container's cores from the shared pool, so *other pods on the node*
cannot run on them. Delegation partitions only the subtree the job owns; it says
nothing about processes outside the pod. The two compose: the runner pod should
be Guaranteed QoS under the static policy on a node nothing else is scheduled to
(the issue's "if other pods can be scheduled onto the same node, the budget is a
limit rather than isolation, and the result says so"), and delegation then divides
the pod's own cores between the roles. The run metadata records
`host.isolation` as `dedicated-node` or `limit`, from what the workflow declares,
because the repository cannot observe it.

### What the pod must provide

These are the preconditions the decision rests on. `bench-partition preflight`
checks the first three on the first step of the job and fails with the reason, so
a pod that cannot host the partition is found before anything is built:

1. The unified (v2) cgroup hierarchy, mounted **writable** inside the container.
   Container runtimes mount `/sys/fs/cgroup` read-only for unprivileged
   containers by default; the runner owner has to change that (a privileged
   runner container, or a runtime that delegates a cgroup subtree).
2. The cgroup the job runs in is delegated to the job's user (it can create
   children and move processes into them).
3. The `cpuset`, `cpu` and `memory` controllers are available in it, enabled by
   the parent. Without `cpuset` the partition cannot give exclusive cores; the
   tooling then refuses unless explicitly told to continue for development, marks
   the run `cpuset_applied: false`, and every window of it invalid.
4. The runner is Guaranteed QoS with whole-CPU requests on a dedicated node, for
   the isolation the cgroups cannot give. Not checked here; declared by the
   workflow (`BENCH_NODE_DEDICATED`).
5. A local volume for the data directory. The disk kind is recorded and a network
   filesystem is refused.

### What is independent of this choice

The issue says the rest of the design holds for both options, and the tooling is
built that way: the boundary between "making the partition" and "using it" is
`partition.json`, which maps each role to a cgroup path, its cores and its memory
limit. Windows, validity rules, run metadata, `compare` and the isolation check
read only that file and the cgroup files it points to. If the runner owner can
only provide option 2, an adapter writes `partition.json` from the containers'
cgroups; `bench-partition up/down` and the server and database start-up in
`bench-lane` are replaced, and the rest stays. That is the cost of the fallback,
and it is bounded.

### How the partition is made

- **CPU by `cpuset`, never by quota.** `cpu.max` stays `max` and `cpu.weight`
  stays default. A quota still lets two processes share a core and adds throttling
  stalls that read as latency.
- **Whole physical cores.** Cores are taken from `thread_siblings_list`; both SMT
  siblings of a core always belong to one role, and a core with a sibling outside
  the delegated cpuset is not used. The server and the load generator never share
  a sibling.
- **Exclusive among the roles by construction.** The role cpusets are disjoint,
  and everything that ran in the delegated cgroup (the runner agent, the step
  shells, the tooling) is moved into a `system` leaf with its own cores, which is
  also what cgroup v2's no-internal-processes rule requires before controllers can
  be handed to children. Cores no role owns stay idle. Where the delegated cgroup
  is itself a partition root, `BENCH_CPUSET_PARTITION=root` additionally removes
  the cores from every other cgroup.
- **Both lanes carve the same cores.** Roles are carved in a fixed order whether
  they run or not, so the SQLite lane keeps the database's cores reserved and idle
  rather than giving them to the server. The server and the load generator get
  identical cores and memory in both lanes, and the lanes differ in the database
  alone.
- **Memory by `memory.max`, sized for the password path.** The API server's limit
  is `BENCH_SERVER_BASE_MIB + BENCH_LOGIN_CONCURRENCY × argon2id memory`, the memory
  read from the pinned `password_hasher.hasher.memory` (64 MiB). Login
  concurrency is bounded by that number, and the value is in the run metadata.
  Swap is off in every cgroup with a memory limit and the server's and database's cgroups die
  as a unit (`memory.oom.group`), so memory pressure shows as an OOM event, which
  invalidates the window, and not as latency.

### Limits stated next to every result

The partition does not hold these apart, and every run's metadata lists them
(`not_partitioned`): the last-level cache, memory bandwidth and controller
queues, interrupt handling, power and thermal headroom shared by the cores, and,
unless the node is dedicated, other pods. File pages the server reads are charged
to its cgroup, so the SQLite lane's page cache counts against the server's limit.

## Alternatives considered

- **A container per role, static CPU manager** (option 2). Rejected as the
  primary design for the reasons above, kept as the fallback and as the pod-level
  complement.
- **`cpu.max` quotas or `cpu.weight`.** Rejected by the issue and kept rejected: a
  quota is a throttle, a weight is a share, and neither stops two processes from
  using the same core.
- **`systemd-run --slice` with `AllowedCPUs` and `MemoryMax`.** The same cgroup
  interface through a manager that a pod's container does not have, and which
  needs the controllers delegated to the user manager as well. Not used; the
  tooling writes cgroupfs directly so it works with or without systemd.

## Consequences

- The runner owner has to provide a writable, delegated cgroup2 mount with the
  `cpuset`, `cpu` and `memory` controllers. That is the first thing to confirm on
  the real runner; until it is, the acceptance criteria that depend on the kernel
  enforcing a cpuset are not demonstrated, only the in-repo half of them
  ([runbook](../runbooks/benchmark-lanes.md#what-needs-the-runner)).
- Teardown is the job's responsibility: it moves the runner agent back, removes
  the cgroups and stops the processes, and it has to run after a cancelled job
  (`if: always()`, plus a runner job-completed hook for a job that never reaches
  its steps). It is idempotent, and starting a lane removes what a killed job
  left behind.
- A lane run on a cgroup without `cpuset` is marked invalid rather than allowed to
  look like a partitioned one.
