# ADR 065: Performance Acceptance Criteria Are Phased, Lane-Scoped, and Derived

> **Status:** Proposed
> **Date:** 2026-09-04
> **Context:** Benchmark epic ([#1094](https://github.com/zitadel/nextgen/issues/1094)) builds a harness but defines no pass mark
> **Relates to:** [ADR 028](028-storage-v2-statements-and-dialects.md) (three dialects; SQLite is not a production peer),
> [ADR 048](048-wide-events-internal-audit-primitive.md) (one audit row per API request)

## Decision

Performance targets live in [`docs/performance/`](../performance/), not in the
benchmark epic and not duplicated across API issues. They are:

- **Phased.** Four phases, P0–P3, each with one question and one gate.
- **Lane-scoped.** A target names its storage dialect and its hardware rung, or
  it is not a target.
- **Derived.** A gate value may only be computed by stated arithmetic from a
  measured cell in the previous phase. Never from an assumed one.
- **Provenance-marked.** Every cell says whether it is unmeasured, assumed,
  measured, or a gate. An empty cell is a valid state and is preferred to a
  plausible one.

An API issue references the matrix by link. It does not copy a number.

## Problem

The benchmark epic explains how nextgen will be measured across nineteen
sub-issues. None of them says what a number has to be. The gap is visible in the
tracker: [#1113](https://github.com/zitadel/nextgen/issues/1113) is filed to
alert on performance regressions against a baseline that no issue creates.

Two positions have to hold at once, and they appear to conflict:

- A launch decision needs one page stating what "good enough" means for latency,
  throughput, error rate and cost.
- The numbers are acceptance criteria of the APIs that own them, not deliverables
  of a measurement harness — and they cannot honestly be written today, because
  the storage architecture has not been verified on either production dialect and
  there is no baseline to reason from.

Setting targets by guessing produces a page that is wrong, is treated as
authoritative, and is quietly ignored the first time it disagrees with reality.
Setting none produces a launch decision made on vibes a week before the date,
which is the failure mode this ADR exists to prevent.

## Context

Three facts constrain any target on this system.

**Nothing is a plain read.** `internal/audit` writes one `request.api` row per
API request (ADR 048, Path A). `/healthz` is excluded; nothing else is. Targets
premised on reads scaling like reads will be wrong on every dialect.

**The `credential` class is bounded by memory.** The password hasher defaults to
argon2id at 64 MiB per verification. That is correct and deliberate. It also
means concurrency on any credential path is a function of server RAM, so that
class needs its own budget and its parameters must be published beside any
figure.

**The SQLite lane cannot produce a throughput number.**
[`internal/storage/dialect/sqlite/dialect.go`](../../internal/storage/dialect/sqlite/dialect.go)
sets `SetMaxOpenConns(1)`, so every statement queues on one connection before
SQLite's own locking applies; `_txlock=immediate` with no `ReadOnly` transaction
option puts a second serialization behind it. Throughput on that lane is
`1 / service_time` by construction. This is the right design for a zero-config
local default (ADR 028) and is not a defect — but a target set on it, or a
resource ladder run against it, measures the connection pool.

## How

**Four phases.** P0 baseline — no performance target at all; the gate is that
every cell is measured, labeled, and reproducible within 10% across two runs.
P1 lenient absolute budgets on the base rung. P2 scaling, gated on efficiency
and explicitly not on absolute latency. P3 launch budgets, error budget, cost,
soak and burst.

P0's gate is what makes the rest honest: it requires a complete labeled
baseline and no invention, and every P1 value is written from it by arithmetic.

**Scaling efficiency is the P2 gate.** `E = (T_2x / T_1x) / 2` per rung
doubling, where `T` is throughput at a fixed latency SLO — the highest sustained
arrival rate holding the class p95 budget, not peak requests per second. Gate at
`E ≥ 0.8`. This turns "it scales" into a pass/fail cell and is what catches
requests serializing on a shared lock.

**Offered load is open-model.** Arrival-rate driven, not a fixed pool of virtual
users. In a closed loop throughput and latency are not independent — workers
back off exactly when the server struggles — so `T` is unmeasurable and the
system's response looks identical whether or not anything is wrong. This
constrains the harness design ([#1095](https://github.com/zitadel/nextgen/issues/1095),
[#1096](https://github.com/zitadel/nextgen/issues/1096)).

**Cross-dialect rungs are calibrated, not asserted.** Processing units do not
convert to vCPU, and a doubling tests different things on each engine —
contention on one box for PostgreSQL, key-range splitting for Spanner. The
Spanner base rung is established in P1 by matching measured base-rung throughput,
recorded as a measured cell, and laddered from there.

**A run is a committed file.** Each acceptance run copies
[`acceptance-template.md`](../performance/acceptance-template.md) into
`docs/performance/runs/`, with the phase's targets pre-filled and measurements
empty. Verdicts are computed from the table, not written by hand. Errors are
counted from raw sample output rather than from logs, and the template carries an
explicit list of run-invalidating conditions.

**Unmet gates block a phase, not a merge.** A failed gate produces a fix in the
*next* phase's scope. Per-merge regression detection is a separate, ratcheted
mechanism on the SQLite lane, whose full serialization makes it the lowest-variance
detector of the three.

## Consequences

- The matrix is mostly `—` today, deliberately, and that is a reportable state
  rather than an unfinished one.
- API issues gain a link, not a number. Changing a budget is a single-file change.
- The SQLite lane is documented as a serial-cost and regression lane. Its
  throughput figure is never published beside PostgreSQL or Spanner.
- The P2 scaling gate applies to PostgreSQL and Spanner only.
- The open-model requirement lands on the harness before it is built, which is
  the cheapest moment for it to land.
- **Phases are not mapped to product roadmap stages here.** The mapping is a
  product decision, the roadmap and the milestone set do not currently agree,
  and inventing that alignment in an ADR would be the same error this document
  is written to avoid. P0–P3 are local to the performance topic until someone
  who owns the roadmap says otherwise.

## Alternatives considered

**Put the numbers in the benchmark epic.** Rejected: it makes the harness the
owner of criteria it does not control, and the epic completes long before the
APIs it measures are optimized.

**Put the numbers in each API issue.** Rejected: nineteen-plus copies of a
budget drift, and there is no single page a launch decision can be made from.
The link-not-copy rule keeps both properties.

**Set targets now, from the reference deployment of current-generation Zitadel.**
Rejected: nextgen is relational with pushed events rather than event-sourced with
projections. Inheriting `8 vCPU / 32 GiB` as a floor assumes the property under
test. It appears in the ladder as a rung, not as a starting point.

**Gate absolute latency in P2.** Rejected: endpoints are expected to be
unoptimized at that stage, so the phase would fail for a reason it is not asking
about, and the scaling signal would be lost in the noise of that argument.
