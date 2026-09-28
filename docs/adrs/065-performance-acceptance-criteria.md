# ADR 065: Performance Acceptance Criteria Are Set in Phases, per Database, from Measurements

> **Status:** Proposed
> **Date:** 2026-09-04
> **Context:** Benchmark epic ([#1094](https://github.com/zitadel/nextgen/issues/1094)) builds the test tooling but does not say what result is good enough
> **Relates to:** [ADR 028](028-storage-v2-statements-and-dialects.md) (three databases; SQLite is not meant for production),
> [ADR 048](048-wide-events-internal-audit-primitive.md) (one audit row per API request)

The first sections are written for everyone. The
[technical background](#technical-background) comes last. Unfamiliar words are
explained in the [glossary](../performance/README.md#glossary).

## Decision

Performance targets live in one place: [`docs/performance/`](../performance/).
They are not in the benchmark epic, and they are not copied into API issues.

- **In phases.** There are four phases, P0 to P3. Each one asks one question and
  has one pass/fail check.
- **Per database and server size.** A target always says which database and
  which server size it applies to. A number without those is not a target.
- **Based on measurements.** A target is always calculated from something we
  measured in the phase before. Never from a guess.
- **Every number shows where it came from.** Each value is marked as not measured
  yet, a guess, measured, or a target. Leaving a cell empty is fine, and better
  than filling it with a number that only looks right.

An API issue links to the targets page. It does not copy a number.

## Problem

The benchmark epic describes, across nineteen sub-issues, how nextgen will be
measured. None of them says what result is good enough. You can see this gap in
the issue tracker: [#1113](https://github.com/zitadel/nextgen/issues/1113) plans
alerts for when performance gets worse than a baseline, but no issue creates
that baseline.

We need two things that seem to conflict:

- For a launch decision, we need one page that says what "good enough" means for
  response time, capacity, errors and cost.
- But those numbers belong to the APIs, not to the test tooling. And we cannot
  write them honestly today: the new storage design has not been tested on
  PostgreSQL or Spanner yet, so there is nothing to base them on.

If we guess the targets now, we get a targets page that is wrong. People will
trust it anyway, and then quietly ignore it the first time real results
disagree with it. If we set no targets at all, the launch decision ends up
being made on gut feeling a week before the date. This ADR exists to prevent
that.

## Consequences

- Most of the targets page is empty today. That is on purpose, and it is a
  valid status to report, not a sign of unfinished work.
- API issues get a link instead of a number. Changing a target means changing
  one file.
- The SQLite setup is only used to measure the cost of a single request and to
  catch slowdowns. Its capacity number is never shown next to PostgreSQL or
  Spanner.
- The P2 scaling check only applies to PostgreSQL and Spanner.
- The test tooling must create load in a specific way (open model, see below).
  We say so now, before the tooling is built, when the change is cheapest.
- **The phases are not linked to the product roadmap here.** That is a product
  decision. The roadmap and the GitHub milestones don't match each other right
  now, and making up a link between them in an ADR would be the same mistake this
  document tries to avoid. P0 to P3 belong only to the performance topic until
  the roadmap owner decides otherwise.

## Alternatives considered

**Put the numbers in the benchmark epic.** Rejected: that makes the test tooling
the owner of targets it does not control. The epic will also be done long
before the APIs it measures are optimized.

**Put the numbers in each API issue.** Rejected: twenty or more copies of the
same target get out of sync, and there is no single page to base a launch
decision on. Linking instead of copying gives us both.

**Set targets now, based on the current Zitadel deployment.** Rejected: nextgen
stores data in a different way than current Zitadel. Taking over
`8 vCPU / 32 GiB` as the minimum would assume the very thing we want to test. It
is one of the tested server sizes, not the starting point.

**Check response times in P2.** Rejected: endpoints are not expected to be
optimized at that stage. The phase would fail for a reason it is not testing,
and the scaling result would get lost in that discussion.

## Technical background

_This section explains the facts behind the decision and how it works in
practice. It is written for engineers._

### Three facts that limit any target

#### Every request writes to the database

`internal/audit` writes one `request.api` row per API request (ADR 048, Path A).
Only `/healthz` is skipped. Targets that assume reads are cheap will be wrong
on every database.

#### The `credential` requests are limited by memory

The password hasher defaults to argon2id with 64 MiB per password check. That is
correct and on purpose. But it means how many credential requests can run at
once depends on the server's RAM. So this request type needs its own target, and
the hasher settings must be published next to any number for it.

#### SQLite handles one request at a time

[`internal/storage/dialect/sqlite/dialect.go`](../../internal/storage/dialect/sqlite/dialect.go)
sets `SetMaxOpenConns(1)`: the server talks to SQLite over exactly one
`database/sql` connection, so every statement, reads included, waits in the Go
connection pool before SQLite's own locking is even checked. `journal_mode(WAL)`
is set and would allow reads in parallel, but the single connection cancels
that out. There is a second queue behind it: transactions start without the
`ReadOnly` option and the DSN sets `_txlock=immediate`, so every transaction,
reads included, takes SQLite's write lock at `BEGIN`.

This is intended. SQLite is the zero-config local default and not meant for
production (ADR 028). What it means for testing:

- Capacity on this setup is always `1 / service_time`. It says nothing about
  the server, and must never be published next to a PostgreSQL or Spanner
  number. Every published SQLite number says so.
- **Doubling the server size changes nothing** when there is only one
  connection, so the P2 scaling check does not run on SQLite.
- Its check is a **service-time floor**. Because everything runs one at a time,
  there is almost no noise: if a request does more work, the result shows it
  directly. That makes it the best setup for catching slowdowns on every merge,
  not the weakest.

### How it works

**Four phases.** P0: baseline, with no performance target at all. It passes when
every cell is measured, labeled, and two runs differ by less than 10%. P1: easy
targets on the base size. P2: scaling, checked on scaling efficiency and on
purpose not on response times. P3: launch targets, error budget, cost, soak and
burst tests.

P0 is what makes the rest honest: it needs a complete, labeled baseline and no
guessing, and every P1 value is calculated from it.

**Scaling efficiency is the P2 gate.** `E = (T_2x / T_1x) / 2` per doubling of
server size, where `T` is throughput within the latency budget: the highest
steady arrival rate at which the p95 of a request type stays within its target,
not the peak requests per second. The gate is `E ≥ 0.8`. This turns "it scales"
into a pass/fail check, and it catches requests that queue up on a shared lock.

**Load is open-model.** Requests arrive at a set rate, not from a fixed number of
virtual users. With a closed model, throughput and latency depend on each other:
workers slow down exactly when the server struggles. That makes `T` impossible
to measure, and a healthy system looks the same as an overloaded one. This is a
requirement on the tooling design
([#1095](https://github.com/zitadel/nextgen/issues/1095),
[#1096](https://github.com/zitadel/nextgen/issues/1096)).

**Server sizes are matched by measurement, not by spec sheet.** Spanner
processing units cannot be converted to vCPU, and doubling tests different
things on each database: whether one bigger machine does more for PostgreSQL,
and whether the data spreads over more key ranges for Spanner. The Spanner base
size is found in P1 by matching the measured throughput of the PostgreSQL base
size, stored as a measured value, and doubled from there.

**Each test run is a committed file.** Each acceptance run copies
[`acceptance-template.md`](../performance/acceptance-template.md) into
`docs/performance/runs/`, with the phase's targets filled in beforehand and the
measurements empty. The verdict follows from the tables and is not a judgement
call. Errors are counted from the raw test output, not from logs, and the
template has a fixed list of problems that make a run invalid.

**A failed gate blocks a phase, not a merge.** A failed gate leads to a fix in
the _next_ phase. Catching slowdowns on every merge is a separate check on the
SQLite setup, where running one request at a time makes it the most stable of
the three.
