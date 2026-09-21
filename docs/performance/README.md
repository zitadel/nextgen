# Performance Acceptance Criteria

What "good enough" means for nextgen, per storage dialect, per hardware class,
per phase. This page owns the numbers. The benchmark harness
([#1094](https://github.com/zitadel/nextgen/issues/1094)) produces them; it does
not decide them.

Policy behind this page: [ADR 065](../adrs/065-performance-acceptance-criteria.md).
Run records: [`runs/`](runs/). Template: [`acceptance-template.md`](acceptance-template.md).

## How to read a cell

Nothing here is asserted. Every cell carries its provenance, and the marker is
part of the value:

| Marker | Meaning |
| --- | --- |
| `—` | Not measured, no target. Honest, and the expected state of most of this page today. |
| `~1000` *(assumed)* | A guess, labeled as one, with the reasoning in a footnote. Never a gate. |
| `825` *(measured, `runs/<file>`)* | Traceable to a committed run record. |
| `≥ 660` *(gate P2)* | A target, derived by stated arithmetic from a measured cell one phase back. |

**An empty cell is honest. A cell copied forward from a previous run is not.**
A number that cannot be traced to a committed run record does not belong on this
page, and a gate may only be derived from a measured cell — never from an
assumed one.

## Phases

Phases are local to this topic. They are **not** GitHub milestones and are not
mapped to the product roadmap; that mapping is a product decision and is
deliberately left open (see ADR 065, *Consequences*).

| Phase | Question it answers | Gate |
| --- | --- | --- |
| **P0** | Can we measure this at all, reproducibly? | **Every cell measured and labeled.** Two runs of the same configuration agree within 10%. No performance target of any kind. |
| **P1** | Is anything catastrophically broken? | Lenient absolute budgets on the base rung. The harness holds a fixed arrival rate for 30 minutes without drift. |
| **P2** | Does it scale with resources? | **Scaling efficiency ≥ 0.8 per doubling.** Absolute latency deliberately not gated. |
| **P3** | Is it fit to launch and to publish? | Absolute per-class budgets, published error budget, cost per 1000 requests, soak and burst. |

P0's gate is the one that matters today. It costs no invention: it is satisfied
by a complete, labeled, reproducible baseline, and every P1 target is written
the day P0's measurements land.

## Lanes

Three deployment lanes, differing in one variable
([#1097](https://github.com/zitadel/nextgen/issues/1097)). Same image, same
manifest, same collector; only the dialect and its storage differ.

| Lane | Answers | Does **not** answer |
| --- | --- | --- |
| **SQLite** (container, local volume, 1 replica) | Per-request **serial** cost, at very low variance. The 1-VU latency floor. | Anything about throughput or scaling — see below. |
| **PostgreSQL** | What most deployments will see. | |
| **Spanner** | Horizontal behavior, and where the interesting failures already live ([#1011](https://github.com/zitadel/nextgen/issues/1011)). | |

### The SQLite lane measures serial cost, never throughput

[`internal/storage/dialect/sqlite/dialect.go`](../../internal/storage/dialect/sqlite/dialect.go)
sets `SetMaxOpenConns(1)`: the server talks to SQLite over exactly one
`database/sql` connection, so every statement — reads included — queues in the Go
pool before SQLite's own locking is consulted. `journal_mode(WAL)` is set and
would allow concurrent reads; the pool of one discards that. A second
serialization sits behind it: transactions begin with no `ReadOnly` option and
the DSN sets `_txlock=immediate`, so every transaction takes SQLite's exclusive
write lock at `BEGIN`, reads included.

This is deliberate and correct — [ADR 028](../adrs/028-storage-v2-statements-and-dialects.md)
states that SQLite is the zero-config local default and not a production peer.
The consequence for this page is what matters:

- Throughput on this lane is `1 / service_time` **by construction**. It is not a
  property of the server and must never be published beside a Postgres or
  Spanner figure.
- **No resource ladder may be run on it.** Adding vCPU to a pool of one changes
  nothing, so the P2 scaling gate is PostgreSQL and Spanner only.
- Its gate is a **service-time floor**, and full serialization makes it nearly
  noiseless — a regression in per-request work shows up proportionally with no
  concurrency noise to hide in. That makes it the best per-merge regression
  detector of the three, not the weakest.

Every published SQLite figure carries that sentence or it invites a comparison
it cannot support.

## Capacity ladders

The two production dialects do not share a unit, and a doubling does not test
the same thing on each.

| Rung | PostgreSQL | Spanner | What a doubling tests |
| --- | --- | --- | --- |
| base | 2 vCPU / 8 GiB | *(calibrated, see below)* | — |
| ×2 | 4 vCPU / 16 GiB | ×2 processing units | PG: contention on one box. Spanner: whether the key layout splits. |
| ×4 | 8 vCPU / 32 GiB | ×4 processing units | |
| ×8 | 16 vCPU / 64 GiB | ×8 processing units | |

`8 vCPU / 32 GiB` is the reference PostgreSQL shape used for current-generation
Zitadel. It appears here as the ×4 rung, not as the starting point: nextgen is
relational with pushed events rather than event-sourced with projections, and
assuming it needs the same floor is exactly the sort of inherited number this
page exists to stop.

**The Spanner base rung is calibrated, not asserted.** Processing units do not
convert to vCPU, and pairing them by price or by spec sheet is a guess. In P1,
find the processing-unit count whose base-rung throughput matches the 2 vCPU
PostgreSQL rung, record it here as a measured cell, and ladder from there. Until
that is done, cross-dialect rows are not comparable and must not be charted on
one axis.

## Operation classes

Latency is gated per class, never globally. A single global budget either passes
trivially or fails on a correct default.

| Class | Operations | Note |
| --- | --- | --- |
| `probe` | `GET /healthz` | No auth, no audit row. The control: bounds the HTTP stack itself. |
| `read-point` | `getSession` `GetUserByID` `getMyUser` `getMySession` `getAuthAttempt` | |
| `read-query` | `querySessions` `queryUsers` `listUserTeams` `listUserPasskeys` | Cursor-paginated ([ADR 027](../adrs/027-cursor-based-pagination.md)). |
| `write` | `createSession` `createUser` `revokeSession` `revokeMySession` `DeleteUserByID` `createAuthAttempt` | |
| `flow-step` | `createFlow` `getFlowStep` `submitFlowStep` (non-credential steps) | |
| `credential` | `setUserPassword` `submitFlowStep` (password) `beginUserPasskeyRegistration` `finishUserPasskeyRegistration` `verifyChallengeProof` | **Memory-bound, see below.** |
| `handoff` | `exchangeHandoff` `createHandoff` `issueChallenge` | |

### The `credential` class is bounded by memory, not CPU

`password_hasher` defaults to argon2id at `time: 3`, `memory: 65536` KiB,
`threads: 4`. That is the correct default and is not a defect. It is a hard
constraint on this page: concurrency on any credential path costs 64 MiB per
in-flight verification, so the class ceiling is a function of server memory, and
a load generator ramping arrival rate on a login flow is measuring RAM.

**Every published `credential` figure states the hasher parameters beside it**,
or it is meaningless. The class target is derived from memory, not guessed.

### Every other class writes to the database

`internal/audit` emits one `request.api` wide event per API request
([ADR 048](../adrs/048-wide-events-internal-audit-primitive.md), Path A).
`/healthz` is excluded; nothing else is. **No endpoint in this API is read-only
at the storage layer**, and any target set on the assumption that reads scale
like reads will be wrong on every lane.

## Metrics, defined

| Metric | Definition |
| --- | --- |
| **Latency** | p50 / p95 / p99 per operation class, measured at a **fixed arrival rate**, stated with the rate. A p95 without its offered load is not a measurement. |
| **Throughput at SLO** `T` | The highest sustained arrival rate at which the class p95 stays inside its budget. Not peak requests per second — peak is always obtainable by accepting worse latency. |
| **Scaling efficiency** `E` | `E = (T_2x / T_1x) / 2` across one rung doubling. `E = 1.0` is perfectly linear. **P2 gate: `E ≥ 0.8`.** |
| **Error rate** | Counted from the raw sample output, never from the log, and split into 5xx / 4xx / check failures. The three have different owners. |
| **Dropped iterations** | Requests the generator could not issue at the configured rate. **Non-zero is a failure**, and it is silent unless a row exists for it. |
| **Cost per 1000 requests** | Derived at the SLO rate from the lane's list price. Shows its inputs or it is not a number. |

### The ladder must be open-model

Offered load is set by a **constant or ramping arrival rate**, independent of
response time. It must not be set by a fixed pool of virtual users waiting on
their own responses.

In a closed loop, throughput and latency are not independent variables: each
worker backs off exactly when the server begins to struggle, so a queue never
forms and `T` cannot be measured. A closed-loop ladder produces flat throughput
with linearly growing latency whether or not anything is wrong, which is
indistinguishable from a healthy system being politely under-driven.

This is a constraint on the harness
([#1095](https://github.com/zitadel/nextgen/issues/1095),
[#1096](https://github.com/zitadel/nextgen/issues/1096)), not only on this page.

## The gates

Targets are `—` until P0 lands. The gate *definitions* are fixed now; the
*values* are derived from measurement, in the phase before.

### P0 — baseline

No performance target. The gate is reproducibility:

- Every cell on this page measured and labeled, on all three lanes.
- Two runs of the same configuration agree within 10% on `T` and class p95.
- One committed run record per lane in [`runs/`](runs/), no empty cells.
- Spanner base rung calibrated against the PostgreSQL base rung.

### P1 — nothing catastrophically broken

Base rung only. PostgreSQL 2 vCPU / 8 GiB, Spanner at its calibrated base.

| Criterion | Value |
| --- | --- |
| Class p95 | `< 1 s` for every class except `credential`, which gets its own memory-derived budget |
| Sustained rate | `≥ 100/s`, held 30 min without latency drift |
| 5xx | `0` |
| Check failures | `< 1%`, counted from raw samples |
| Dropped iterations | `0` |

Deliberately lenient. P1 is a liveness gate at realistic-but-modest load, not an
optimization target.

### P2 — it scales

The doubling matrix, PostgreSQL and Spanner. **Absolute latency is not gated**:
individual endpoints are expected to be unoptimized at this point, and gating
them here would fail the phase for the wrong reason.

| Criterion | Value |
| --- | --- |
| Scaling efficiency | `E ≥ 0.8` at every rung doubling |
| Queue behavior | `p99 / p50 < 10` at the SLO rate |
| Dropped iterations | `0` at every rung |
| SQLite lane | Service-time floor held within tolerance. **Not laddered.** |

This is the phase that catches work piling up on a shared lock, and it is the
phase whose result is the honest answer to "can you handle web scale".

### P3 — fit to launch

Absolute per-class latency budgets, derived from P2's measurements; the
throughput figure that goes on a public page; a published error budget; cost per
1000 requests per lane and rung; plus soak (multi-hour, memory and lag stable)
and burst (step change in arrival rate, recovery time bounded).

## Cadence

| Lane | When | Why |
| --- | --- | --- |
| SQLite | per merge | Cheapest standing deployment of the three, and the lowest-variance regression detector. Ratcheted: a measured service time becomes a floor with a tolerance band. |
| PostgreSQL | weekly | |
| Spanner | weekly | |
| Full matrix | phase gate | |

Cadence mechanics belong to
[#1113](https://github.com/zitadel/nextgen/issues/1113); the ratchet values
belong here.

## Referencing this page from an API issue

An endpoint's acceptance criteria links, and does not copy:

> Meets the **P2** budget for its operation class in
> [`docs/performance/README.md`](README.md).

A copied number is a number that will drift. The one page moves; the issues
follow it.
