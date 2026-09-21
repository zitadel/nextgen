# ADR 065: SQL-Backed Background Jobs

> **Status:** Proposed
> **Date:** 2026-09-03
> **Context:** Periodic sweeps and queued work in the Go server across PostgreSQL, Spanner, and SQLite
> **Builds on:** [ADR 028](028-storage-v2-statements-and-dialects.md), [ADR 041](041-storage-statement-contract-tests.md), [ADR 047](047-dialect-id-generation.md), [ADR 048](048-wide-events-internal-audit-primitive.md), [ADR 049](049-events-api-retention-export.md)
> **Amends if accepted:** [ADR 046](046-claim-lifecycle-v2.md) (unclaimed-project **deletion** can run on this loop; this ADR does not add that sweeper)
> **Related:** [ADR 010](010-session-auth-attempt-check-model.md), [ADR 037](037-token-lifecycle.md), [ADR 039](039-signing-key-rotation-and-incident-response.md), [ADR 050](050-dev-inbox.md), [#881](https://github.com/zitadel/nextgen/issues/881)

## Context

Today each background sweeper has its own loop in the process:

- Event retention ([`internal/audit/retention.go`](../../internal/audit/retention.go)) is started from [`cmd/server/server.go`](../../cmd/server/server.go).
- The event shipper is a separate poller.
- Path A request wide events sit in an in-process buffer; [ADR 048](048-wide-events-internal-audit-primitive.md) defers a durable outbox.

We need the same kind of work for more than retention: expired-session cleanup that can write a `session.expired` event ([#881](https://github.com/zitadel/nextgen/issues/881)), auth-attempt TTL ([ADR 010](010-session-auth-attempt-check-model.md)), and later outbound mail ([ADR 050](050-dev-inbox.md)).

This ADR is **not** [ADR 046](046-claim-lifecycle-v2.md) project claim (the HTTP flow that assigns an owning team to a project). Below, **Take** means “this server picks up a **job row** and runs it.” It does not look at `projects.created_at`. Deleting unclaimed projects stays an ADR 046 non-goal.

Storage is SQL on three dialects ([ADR 028](028-storage-v2-statements-and-dialects.md)): PostgreSQL, Spanner, and SQLite. A job system that exists only on Postgres (River) or only on GCP (Pub/Sub) does not cover that set.

## Decision

**First implementation** means what this ADR ships: the table, the in-process loop, and cutting event retention onto it. Later jobs (`sessions.gc`, mail) are follow-ups.

How a job runs:

1. Someone inserts a row (`Enqueue`) or, for a sweep, boot upserts one row (`UpsertPeriodic`).
2. A running server **Takes** that row: it writes a time-limited lease so other servers leave it alone.
3. **Perform** does the real work (delete old events, send mail, …) outside that Take transaction.
4. **Complete** or **Fail** writes the outcome back.

### Row model

One `jobs` table. Column types are dialect-owned; this is the logical shape:

| Column | Role |
|--------|------|
| `id` | dialect-minted `job_<opaque>` ([ADR 047](047-dialect-id-generation.md) §3). Not an HTTP resource. |
| `name` | which handler to run (`jobs.gc`, `email.send`, …). Not unique. Many queued rows share one `name`. |
| `payload` | opaque bytes. Empty for sweeps. |
| `unique_key` | stops two **live** rows (`pending` or `leased`) from being the same logical job. Periodic: required, equal to `name`. Queued: optional. Many nulls are allowed. |
| `run_at` | do not start **before** this time (database clock). |
| `not_after` | do not start **at or after** this time (database clock). Nullable. Same type as `run_at`. Periodic: always null. Queued: optional; copy the payload’s useful life (verification-code expiry, magic-link TTL). Too late when `not_after <= now()`. |
| `period` | how often a sweep should run. Set on periodic rows; null on queued rows. |
| `lease_until`, `lease_by` | who holds the row and until when. |
| `lease_token` | one-time value from this Take. Heartbeat, Complete, and Fail must send it back. A late Complete from an old worker cannot overwrite a new lease. |
| `attempt`, `last_error` | retry bookkeeping. |
| `status` | `pending` (waiting to run), `leased` (a server is working it), `done`, `dead`. Periodic rows are only `pending` or `leased`. |
| `completed_at` | set when a queued row becomes `done` or `dead`. |

**`unique_key` in plain terms.** `name` says which handler. `unique_key` is a separate column so the database can reject a duplicate of the same logical job while that job is still waiting or running.

- Periodic: `unique_key` is required and equal to `name`. There is one `jobs.gc` row, forever.
- Queued: omit `unique_key` to insert a new row on every Enqueue. Set it (for example `email.send:{user_id}:welcome`) so a second Enqueue while the first is still `pending` or `leased` keeps the existing row and does not insert another.
- After the row is `done` or `dead`, the same `unique_key` may be enqueued again (a verification-code resend is a new job).

**Take** looks at rows that are waiting (`pending`) or whose lease has expired (`leased` and `lease_until < now()`). That includes rows whose `not_after` has already passed, so a crash mid-run is not stranded. It ignores `done` and `dead`. It does not look at projects.

### 1. Two kinds of row, one shared line

Periodic sweeps and queued work are both rows in the same table, ordered by `run_at`.

| Kind | How many rows are due at once | How many can run at once cluster-wide |
|------|-------------------------------|----------------------------------------|
| Unique periodic (`jobs.gc`, later `sessions.gc`) | one row (`unique_key` = `name`) | at most one of that name |
| Queued (`email.send`) | one per unit of work | as many as there are free workers |

How many jobs run at once: `number of processes × jobs.concurrency`. With three servers and `jobs.concurrency = 1`, three jobs run at a time.

There is no separate mail queue versus GC queue. Workers take the next due row, whatever `name` it has. If 10,000 `email.send` rows are due, `jobs.gc` waits its turn. We accept that for the first implementation. Per-name caps and fair mixing are later work.

### 2. Portability is `JobStatements`

The dialect adapter is [`service.AllStatements`](../../internal/service/statement.go). Dialects write the SQL.

Who opens the transaction:

- `Enqueue` and `UpsertPeriodic` use the caller’s transaction (the product write, or boot).
- `Take`, `Heartbeat`, `Complete`, `Fail`, and `DeleteCompleted`: the **engine** opens the read/write transaction. Those methods do not open a second, nested one.

That split does not change in Go 1.27. The TODO around [`internal/service/statement.go`](../../internal/service/statement.go) line 195 is about generic pool types, not who begins a transaction. Do not copy `CreateSession`: that method starts its own `withTransaction`.

- `Enqueue` — insert a queued job in the product transaction. If a live row already has this `unique_key`, keep that row.
- `Take` — write a lease on a runnable row, or mark a past-`not_after` row `dead` without running it. Returns `lease_token`.
- `Complete` / `Fail` — §3 (queued and periodic differ). Must send `id` + `lease_token`.
- `UpsertPeriodic` — boot, not `Enqueue`. Insert sets the sweep row. If it already exists, update `period` from config only. Do not overwrite `lease_until`, `lease_by`, `lease_token`, or `run_at` while another replica holds a live lease.
- `DeleteCompleted` — delete `done`/`dead` rows whose `completed_at` is older than the retain window.
- `Heartbeat` — extend `lease_until` where `id` and `lease_token` match this Take.

The first implementation does not add a `Backend` interface, a memory backend, River, Pub/Sub, or Cloud Tasks.

`Enqueue` is lookup-then-insert inside the caller’s transaction. Spanner will not use `INSERT ... ON CONFLICT` on a `NULL_FILTERED` unique index ([`internal/storage/dialect/spanner/auth_attempt.go`](../../internal/storage/dialect/spanner/auth_attempt.go)). Lookup-then-insert is also not enough by itself: a unique index on `unique_key` would still see `done`/`dead` rows, so a resend would bounce until GC. Same trick as authz in [`internal/storage/dialect/spanner/migration/sql/000018_authz_mvp.sql`](../../internal/storage/dialect/spanner/migration/sql/000018_authz_mvp.sql) (lines 9–11): Spanner keeps `active_unique_key` equal to `unique_key` while the row is `pending`/`leased`, and **NULL** when `done`/`dead`. Postgres uses a partial unique index on live rows. When a queued row finishes or dies, that live key is cleared so the next Enqueue can insert.

### 3. Lease, then work, then complete

```mermaid
sequenceDiagram
  participant Node as Replica
  participant Jobs as jobs_table
  participant Handler as Perform

  loop poll_interval
    Node->>Jobs: Take due rows
    alt deadline passed
      Node->>Jobs: mark dead, no Perform
    else row is runnable
      Node->>Handler: Perform
      Node->>Jobs: Heartbeat during Perform
      Node->>Jobs: Complete or Fail
    end
  end
```

The `alt` / `else` in that diagram is mermaid’s “if / otherwise.” If `not_after` has passed, mark the row `dead`. Otherwise run it.

1. **Take** — pick a due row (waiting, or lease expired). Then:
   - If `not_after <= now()`: mark `dead`, set `completed_at`, do not Perform. Any replica may do this. It does not need to know the handler. This is how a job that outlived its useful life is closed, including after a crash.
   - Else if this process registered that `name`: write the lease (`lease_until = now() + lease_duration`, a new `lease_token`), commit, Perform.
   - Else: leave the row. Do not Fail it. An old binary, or a process that did not register `events.retention`, must not burn retries on a job it cannot run.

   **Process** means one `zitadel start` replica: that OS process / container. **Registered `name`** is the in-memory handler list this binary built at boot. It is not stored on the row.

   If `not_after` passes **while this replica still holds a live lease**, it finishes Perform. The deadline is “do not **start** at or after.” Do not steal mid-run. After the lease expires, Take may see the row and mark `dead` without a second Perform. The old worker’s late Heartbeat, Complete, or Fail must send the old `lease_token` and is a no-op.

2. **Perform** — do the handler work in its own transactions or I/O. Keep Heartbeat going so the lease does not expire under a long run.
3. **Complete** or **Fail**. Both must match `lease_token`.

Complete:

- Queued success → `done` + `completed_at`. Clear `active_unique_key` / the live unique projection. Reset `attempt`.
- Periodic success → keep the same row. Clear the lease. Set `run_at = now() + period` (skip missed beats; do not add `period` onto the old `run_at`). Reset `attempt`. Never `done`. No history row.

Fail:

- Queued: increment `attempt`. Clear the lease. Set `status = pending` and `run_at = now() + backoff`. Become `dead` (with `completed_at`) when `attempt` reaches `max_attempts`, or when the next `run_at` would be `>= not_after`. Dying also clears the live unique key.
- Periodic: never `done` or `dead`. Clear the lease. Set `run_at = now() + period` (same skip-missed as Complete). Record `last_error`. Fail does not count toward death. The first implementation does not revive a `dead` periodic row because periodic rows never reach `dead`.

`not_after` only decides whether the engine **starts** the job. The handler still no-ops if the live entity is gone, used, or rotated.

If the lease expires (crash, or a missed Heartbeat), another replica may Take the row. Delivery is at-least-once. Handlers must be safe to run twice: a crash after a side effect and before Complete retries the same row.

### 4. Database clock; dialect-owned duration columns

Due checks and reschedule use the database clock (`now()` / `CURRENT_TIMESTAMP`), not the Go wall clock ([ADR 048](048-wide-events-internal-audit-primitive.md)).

The Go API is `time.Duration`. Column types follow sessions: Postgres `INTERVAL`, Spanner `INT64` nanoseconds, SQLite `INTEGER` nanoseconds. Dialects bind `time.Duration` and implement `run_at = now() + period`. [`stmttest`](../../internal/storage/stmttest/) never sees the column type.

### 5. Periodic jobs are one unique row

Uniqueness is the `unique_key` column, not `name`. Periodic registration sets `unique_key = name` (for example both `jobs.gc`), a non-null `period`, and `not_after` null. Missed beats already skip via `run_at = now() + period`. Boot calls `UpsertPeriodic` on that key. Config remains the knob; replicas overwrite `period` from config. The row is the shared “when did this sweep last run,” not a second config store.

`period` lives on the row so Complete can reschedule in SQL without the completing replica’s in-memory catalog.

Handlers and boot-time period come from registration. The unique row owns `run_at` / `period` for Take and Complete.

### 6. Queued work is inserted in the product transaction

A service calls `Enqueue` on the statements of the transaction that wrote the entity (create user + `email.send`). If that transaction rolls back, the job is gone. After commit, any replica can Take the row.

Queued rows share `name` (`email.send`) and usually leave `unique_key` null, so each Enqueue inserts. If `unique_key` is set, a second Enqueue while the first is still live keeps the existing row. After `done`/`dead`, Enqueue inserts again.

Enqueue may set `not_after` from the entity TTL in the same transaction (do not send a verification mail after the code is dead).

### 7. Retain, then `jobs.gc`

`done` and `dead` stay in the table until unique periodic `jobs.gc` calls `DeleteCompleted`: delete rows whose `completed_at` is older than the retain window (time-only, same idea as [ADR 049](049-events-api-retention-export.md)). GC does not delete `pending` or `leased` rows. Take owns past-`not_after` expiry.

No dead-letter table. `dead` stays queryable until GC.

### 8. Observability (metrics, not an API)

Operators watch the engine. There is no job HTTP API and no dead-letter table.

Every series is labeled by handler `name` (`jobs.gc`, `email.send`, …). No other labels in the first implementation (`status`, replica, dialect). The outcome is the series name, not a `status` label. Increment one per row, not per batch.

Counters:

- `jobs_taken` — Take leased a row that will Perform.
- `jobs_completed` — Complete succeeded (queued → `done`, or periodic reschedule).
- `jobs_failed` — any Fail that puts the row back to `pending` (queued retry, or a periodic failure).
- `jobs_dead` — queued Fail exhausted retries, or retry would next run at or after `not_after`.
- `jobs_expired` — Take marked `dead` because `not_after` had passed, whether or not a previous Perform ran.

`jobs_expired` does not also increment `jobs_dead`. `jobs_dead` is the queued Fail path. Periodic Fail increments `jobs_failed` and never `jobs_dead`.

Histograms:

- `jobs_perform_duration` — handler wall time from Take commit to Complete or Fail.
- `jobs_take_lag` — `now() - run_at` at Take, same database clock as due checks (§4).

The first implementation does not emit a pending-depth gauge (`COUNT(*)` of due `pending` every poll). Operators infer backup from take lag and `jobs_taken`.

### 9. Every replica runs the loop; the lease is the lock

The engine starts with the HTTP server on `zitadel start`. No `zitadel worker` command, no leader election, no job HTTP API, not an OpenAPI resource.

Take SQL is dialect-owned:

- Postgres: `FOR UPDATE SKIP LOCKED`
- Spanner: add jitter to the poll; try to take the lease on one row in the read-write transaction so other replicas abort instead of all locking the same head
- SQLite: single writer

Two clocks: `jobs.poll_interval` is how often a process asks the table for due work. `period` on a unique row is how often that sweep may run.

Defaults for the first implementation (config key names are an implementation detail; the numbers are the contract):

| Knob | Default | Role |
|------|---------|------|
| `jobs.concurrency` | `1` | How many Take/`Perform` loops this process runs in parallel |
| `jobs.poll_interval` | ~1s | Idle wait between Takes |
| `jobs.take_batch_size` | `1` | Rows one loop leases per Take |
| `jobs.lease_duration` | 15m | Take writes `lease_until`; covers today’s retention 10m timeout ([`internal/audit/retention.go`](../../internal/audit/retention.go)) plus margin |
| `jobs.heartbeat_interval` | 5m | Heartbeat while Perform runs (lease/3) |
| `jobs.max_attempts` | 5 | Queued Fail ceiling |
| `jobs.backoff_cap` | 1h | Exponential backoff from `poll_interval` |
| `jobs.retain` | 7d | `DeleteCompleted` window; independent of ADR 049’s 30d event window |

SQLite stays at concurrency 1. Postgres/Spanner may raise concurrency when queued I/O exists. Keep the take batch small so other nodes can take remaining rows. Deleting N expired sessions inside one `Perform` belongs in the handler, not in `take_batch_size`.

A replica that has not registered a name (old binary, or `events.retention` off) never Takes that name for Perform. Marking expired rows `dead` does not use that filter. Old binaries must not delete unknown job types.

### 10. Background Path B uses `system` actor

Handlers that emit wide events ([ADR 048](048-wide-events-internal-audit-primitive.md)) stamp `EventActorTypeSystem`. A reaper `session.expired` must not look like a missing request `ActorContext`.

### 11. What we ship first

- Jobs table, `JobStatements`, in-process loop, unique periodic `jobs.gc`
- Cut [`RetentionJob`](../../internal/audit/retention.go) over to unique periodic `events.retention` that still calls `DeleteEventsOlderThan` ([ADR 049](049-events-api-retention-export.md))
- Unchanged: event shipper, Path A request buffer
- `email.send` is an example producer, not a deliverable of this first implementation
- Next job: `sessions.gc` / [#881](https://github.com/zitadel/nextgen/issues/881). Read-time session expiry stays; the reaper is the Path B producer (emit `session.expired` then delete or mark). One unique periodic row, not one job per session.

## Non-goals

- Unclaimed-project deletion ([ADR 046](046-claim-lifecycle-v2.md)). This ADR does not add `WHERE projects.created_at + interval` and does not delete unclaimed projects. A future sweeper would be its own periodic job on this loop.
- [ADR 049](049-events-api-retention-export.md)’s dedicated `DELETE` role on the jobs table
- Signing-key purge ([ADR 039](039-signing-key-rotation-and-incident-response.md)) and ADR 050 outbound as handlers in this first implementation. Token rows do not need a sweeper: [ADR 037](037-token-lifecycle.md) deletes a revoked token on the spot, and expiry is checked from the token itself.

## Consequences

### Positive

- Sweeps and queued work share one runtime, one test seam, and one shutdown path.
- Enqueue joins the product transaction without a second API.
- Rolling deploys reschedule periodic jobs from the row’s `period`.
- SQLite, Postgres, and Spanner stay on the statements model used for sessions and events.

### Negative / Risks

- **At-least-once:** a handler that succeeds at a side effect and crashes before Complete will run again. The handler must tolerate that. A missed Heartbeat is the same: another replica may take the row. The old worker’s Complete then no-ops because `lease_token` no longer matches.
- **Shared line:** `ORDER BY run_at` can let a pile of queued rows delay a due sweep until a worker is free.

### Testing

- [`stmttest`](../../internal/storage/stmttest/) owns, across dialects via `forEachDialect` ([ADR 041](041-storage-statement-contract-tests.md)): Take of pending and lease-expired rows; Take marking `not_after <= now()` `dead` without Perform (including a reclaimed lease, and the equality case); Fail returning queued rows to `pending` with backoff; queued Fail-to-dead at `max_attempts` and when the next `run_at` would be `>= not_after`; periodic Fail rescheduling `run_at = now() + period` without `dead`; Complete resetting `attempt`; live-row `unique_key` conflict vs insert after `done`/`dead` (Spanner `active_unique_key` null on terminal); `UpsertPeriodic` updating `period` without clobbering a live lease; `DeleteCompleted` ignoring `pending`/`leased`; Heartbeat/Complete/Fail rejected when `lease_token` does not match; lookup-then-insert Enqueue (not `ON CONFLICT`).
- The engine loop is tested against a fake `JobStatements` (or sqlite only), not a second backend × three-dialect matrix: registered-name Take filter, Heartbeat, unknown names left untouched.

## Alternatives considered

| Alternative | Why rejected |
|-------------|--------------|
| River as the portability layer | Postgres-only; SQLite and Spanner still need another runtime |
| Pub/Sub / Cloud Tasks as source of truth | No transactional enqueue with the entity write; no SQLite |
| Insert a tick row per period | Backlog of missed intervals; the unique row already remembers the next run |
| `INSERT ... ON CONFLICT` as the Enqueue contract | Spanner rejects a `NULL_FILTERED` unique index as an `ON CONFLICT` arbiter |
| Call the pick-up step `Claim` | Collides with ADR 046 project claim |
