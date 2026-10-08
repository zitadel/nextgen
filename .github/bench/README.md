# Benchmark lanes

Provisioning for the two benchmark lanes (SQLite and PostgreSQL) on a Depot runner,
partitioned by cgroup v2. The design, the validity rules and the teardown are in the
runbook: [`docs/runbooks/benchmark-lanes.md`](../../docs/runbooks/benchmark-lanes.md);
the decision is [ADR 069](../../docs/adrs/069-benchmark-runner-cgroup-partition.md).

```sh
.github/bench/test/run.sh            # the tests; no privileges needed
.github/bench/bin/bench-lane --help  # up / down / declare-args / compare / assert-*
```
