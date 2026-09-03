# ADR 061: SQL-Backed Background Jobs

> **Status:** Proposed
> **Date:** 2026-09-03
> **Context:** Periodic sweeps and queued work in the Go server across PostgreSQL, Spanner, and SQLite
> **Builds on:** [ADR 028](028-storage-v2-statements-and-dialects.md), [ADR 041](041-storage-statement-contract-tests.md), [ADR 047](047-dialect-id-generation.md), [ADR 048](048-wide-events-internal-audit-primitive.md), [ADR 049](049-events-api-retention-export.md)
> **Amends:** [ADR 046](046-claim-lifecycle-v2.md) (the “no scheduled-task infrastructure” non-goal)
> **Related:** [ADR 010](010-session-auth-attempt-check-model.md), [ADR 037](037-token-lifecycle.md), [ADR 039](039-signing-key-rotation-and-incident-response.md), [ADR 050](050-dev-inbox.md), [#881](https://github.com/zitadel/nextgen/issues/881)

## Context

The server already runs background work, but each piece owns its own ticker:

- Event retention ([`internal/audit/retention.go`](../../internal/audit/retention.go)) is a process-local loop started from [`cmd/server/server.go`](../../cmd/server/server.go).
- The event shipper is a separate poller over sink cursors.
- Path A request events use an in-process buffer; [ADR 048](048-wide-events-internal-audit-primitive.md) defers a durable outbox.

Authorization expiry is read-time (`expires_at < now()` on sessions). That rejects an expired session; it cannot emit Path B `session.expired`, which needs a writer ([#881](https://github.com/zitadel/nextgen/issues/881)). Auth-attempt TTL cleanup ([ADR 010](010-session-auth-attempt-check-model.md)), claim-challenge GC, and later outbound mail (ADR 050) need the same scheduled or enqueued work.

Storage is SQL-first on three dialects ([ADR 028](028-storage-v2-statements-and-dialects.md)). PostgreSQL and Spanner are production peers; SQLite is the zero-config local default. A job runtime that exists only on Postgres (River) or only on GCP (Pub/Sub) does not cover that matrix.

## Decision

### Row model

One `jobs` table. Columns (logical; DDL is dialect-owned):

| Column | Role |
|--------|------|
| `id` | dialect-minted `job_<opaque>` ([ADR 047](047-dialect-id-generation.md) §3). Not an HTTP resource. |
| `name` | handler to run. Not unique. Many queued rows share one `name`. |
| `payload` | opaque bytes; empty for sweeps. |
| `unique_key` | uniqueness constraint, nullable. `UNIQUE` where not null (multiple nulls allowed). Periodic: required, equal to `name`. Queued: optional (set for idempotent enqueue). |
| `run_at` | do not start before (database clock). |
| `not_after` | do not start after (database clock). Nullable. Same type as `run_at`. Periodic: always null. Queued: optional; copy the payload’s useful life (verification-code expiry, magic-link TTL). |
| `period` | set on unique periodic rows; null on queued rows. |
| `claimed_until`, `claimed_by` | lease. |
| `attempt`, `last_error` | retry bookkeeping. |
| `status` | `pending`, `claimed`, `done`, `dead`. |
| `completed_at` | set when moving to `done` or `dead`. |

`Claim` selects `pending` (or lease expired) with `run_at <= now()` and `(not_after IS NULL OR not_after > now())`, ordered by `run_at`, and ignores `done`/`dead`.

### 1. Two row kinds, one `ORDER BY run_at`

Periodic sweeps and queued work are both rows.

| Kind | Rows due at once | In flight cluster-wide |
|------|------------------|------------------------|
| Unique periodic (`jobs.gc`, later `sessions.gc`) | one row (`unique_key` = `name`) | at most one of that name |
| Queued (`email.send`) | one per unit of work | up to remaining claimers |

Parallelism is in-flight `Perform`s: `replicas × jobs.concurrency`. Named queues, per-name concurrency caps, and fair mixing are out of v1. A flood of queued rows can delay a due periodic row; that starvation is accepted.

### 2. Portability is `JobStatements`

The dialect adapter is [`service.AllStatements`](../../internal/service/statement.go). `JobStatements` is tx-passive `Enqueue`, `Claim`, `Complete`, `Fail`. Dialects hand-write the SQL.

v1 does not add a `Backend` interface, a memory backend, River, Pub/Sub, or Cloud Tasks.

Callers enqueue with one method on the statements they already hold: `pool.Statements()` or the open transaction’s statements. Same pattern as `CreateSession` and `CreateUser`.

### 3. Lease, then work, then complete

```mermaid
sequenceDiagram
  participant Node as Replica
  participant Jobs as jobs_table
  participant Handler as Perform

  loop poll_interval
    Node->>Jobs: Claim due rows
    alt got rows
      Node->>Handler: Perform
      Node->>Jobs: Complete or Fail
    end
  end
```

1. **Claim** — write the lease, commit.
2. **Perform** — handler work in its own transactions or I/O, not the claim transaction.
3. **Complete** or **Fail**.

Complete:

- Queued success → `done` + `completed_at`.
- Periodic success → same unique row, lease cleared, `run_at = now() + period` (skip missed beats, not `run_at + period`). No history row.

Fail: backoff then `dead`. A unique periodic row must not stay leased forever (otherwise that sweep never runs again). Retry that would next run at or after `not_after` goes `dead` instead of rescheduling.

Past-`not_after` rows are not Performed. Mark them `dead` (with `completed_at`) rather than leaving them pending. A reclaimed lease after the deadline must not Perform.

`not_after` is an engine filter, not domain truth. Perform still no-ops if the live entity is gone, used, or rotated.

An expired lease makes the row claimable again. Delivery is at-least-once. Handlers must be idempotent: a crash after a side effect and before Complete retries the same row.

### 4. Database clock; dialect-owned duration columns

Due checks and reschedule use the database clock (`now()` / `CURRENT_TIMESTAMP`), not the Go wall clock ([ADR 048](048-wide-events-internal-audit-primitive.md)).

The Go API is `time.Duration`. Column types follow sessions: Postgres `INTERVAL`, Spanner `INT64` nanoseconds, SQLite `INTEGER` nanoseconds. Dialects bind `time.Duration` and implement `run_at = now() + period`. [`stmttest`](../../internal/storage/stmttest/) never sees the column type.

### 5. Periodic jobs are one unique row

Uniqueness is the `unique_key` column, not `name`. Periodic registration sets `unique_key = name` (for example both `jobs.gc`), a non-null `period`, and `not_after` null. Missed beats already skip via `run_at = now() + period`. Boot upserts on that key. Config (viper) remains the knob; replicas overwrite `period` from config. The row is the shared cursor, not a second config store.

`period` lives on the row so Complete can reschedule in SQL without the completing replica’s in-memory catalog.

Handlers and boot-time period come from registration. The unique row owns `run_at` / `period` for Claim and Complete.

### 6. Queued work is inserted in the product transaction

A service calls `Enqueue` on the statements of the transaction that wrote the entity (user create + `email.send`). Rollback drops the job. After commit, any replica can Claim the row.

Queued rows share `name` (`email.send`) and usually leave `unique_key` null — each Enqueue inserts. If `unique_key` is set (for example `email.send:{user_id}:welcome`), Enqueue is idempotent: a conflict keeps the existing row.

Enqueue may set `not_after` from the entity TTL in the same transaction (do not send a verification mail after the code is dead).

### 7. Retain, then `jobs.gc`

`done` and `dead` linger until unique periodic `jobs.gc` deletes them by `completed_at` older than a retain window (time-only, same idea as [ADR 049](049-events-api-retention-export.md)). `jobs.gc` also drops leftover `pending` rows with `not_after < now()` if Claim did not mark them `dead`.

No dead-letter table. `dead` stays queryable until GC.

### 8. Observability (metrics, not an API)

Operators watch the engine. There is no job HTTP API and no dead-letter table.

Every series is labeled by handler `name` (`jobs.gc`, `email.send`, …). No other v1 labels (`status`, replica, dialect). Outcome lives in the series name, not a `status` label. Increment one per row, not per batch.

Counters:

- `jobs_claimed` — Claim leased a row that will Perform.
- `jobs_completed` — Complete succeeded (queued → `done`, or periodic reschedule).
- `jobs_failed` — Fail with retry (backoff; row stays claimable).
- `jobs_dead` — Fail exhausted retries, or retry would next run at or after `not_after`.
- `jobs_expired_unrun` — Claim found `not_after <= now()` and marked `dead` without Perform, or `jobs.gc` dropped leftover `pending` with `not_after < now()`.

`jobs_expired_unrun` does not also increment `jobs_dead`. `jobs_dead` is the Perform/Fail path; `jobs_expired_unrun` is never-started.

Histograms:

- `jobs_perform_duration` — handler wall time from Claim commit to Complete or Fail.
- `jobs_claim_lag` — `now() - run_at` at claim, same database clock as due checks (§4).

v1 does not emit a pending-depth gauge (`COUNT(*)` of due `pending` every poll). Operators infer backup from claim lag and `jobs_claimed`.

### 9. Every replica runs the loop; the lease is the lock

The engine starts with the HTTP server on `zitadel start`. No `zitadel worker` command, no leader election, no job HTTP API, not an OpenAPI resource.

Claim SQL is dialect-owned:

- Postgres: `FOR UPDATE SKIP LOCKED`
- Spanner: read due rows and write a lease if still unclaimed (strong / RW)
- SQLite: single writer

Two clocks: `jobs.poll_interval` is how often a process asks the table for due work. `period` on a unique row is how often that sweep may run.

v1 knobs (viper paths are an implementation detail):

| Knob | v1 default | Role |
|------|------------|------|
| `jobs.concurrency` | `1` | Parallel Claim/`Perform` loops per process |
| `jobs.poll_interval` | ~1s | Idle wait between Claims |
| `jobs.claim_batch_size` | `1` | Rows one loop leases per Claim |

SQLite stays at concurrency 1. Postgres/Spanner may raise concurrency when queued I/O exists. Keep the claim batch small so other nodes can take remaining rows. Inner batching (delete N expired sessions per `Perform`) belongs in the handler.

On a rolling deploy, a row whose `name` has no handler on this binary stays and retries with backoff. Old binaries must not delete unknown job types.

### 10. Background Path B uses `system` actor

Handlers that emit wide events ([ADR 048](048-wide-events-internal-audit-primitive.md)) stamp `EventActorTypeSystem`. A reaper `session.expired` must not look like a missing request `ActorContext`.

### 11. v1 cutover

- Jobs table, `JobStatements`, in-process loop, unique periodic `jobs.gc`
- Cut [`RetentionJob`](../../internal/audit/retention.go) over to unique periodic `events.retention` that still calls `DeleteEventsOlderThan` ([ADR 049](049-events-api-retention-export.md))
- Unchanged: event shipper, Path A request buffer
- `email.send` is an example producer, not a v1 deliverable
- Next job: `sessions.gc` / [#881](https://github.com/zitadel/nextgen/issues/881). Read-time session expiry stays; the reaper is the Path B producer (emit `session.expired` then delete or mark). One unique periodic row, not one job per session.

## Non-goals

- Unclaimed-project expiry ([ADR 046](046-claim-lifecycle-v2.md); this ADR only supplies instance scheduling)
- [ADR 049](049-events-api-retention-export.md)’s dedicated `DELETE` role on the jobs table
- Token-row GC, signing-key purge, and ADR 050 outbound as v1 handlers

## Consequences

### Positive

- Sweeps and queued work share one runtime, one test seam, and one shutdown path.
- Enqueue joins the product transaction without a second API.
- Rolling deploys reschedule periodic jobs from the row’s `period`.
- SQLite, Postgres, and Spanner stay on the statements model used for sessions and events.

### Negative / Risks

- **At-least-once:** a handler that succeeds at a side effect and crashes before Complete will run again. Idempotency is the handler’s problem.
- **Starvation:** `ORDER BY run_at` can let a queued flood delay a due unique periodic row until a claimer is free.

### Testing

- [`stmttest`](../../internal/storage/stmttest/) owns Claim, unique keys, lease expiry, enqueue-in-tx, periodic reschedule, Claim skipping `not_after <= now()`, and Fail-to-dead when retry would miss `not_after`, across dialects via `forEachDialect` ([ADR 041](041-storage-statement-contract-tests.md)).
- The engine loop is tested against a fake `JobStatements` (or sqlite only), not a second backend × three-dialect matrix.

## Alternatives considered

| Alternative | Why rejected |
|-------------|--------------|
| River as the portability layer | Postgres-only; SQLite and Spanner still need another runtime |
| Pub/Sub / Cloud Tasks as source of truth | No transactional enqueue with the entity write; no SQLite |
| Insert a tick row per period | Backlog of missed intervals; the unique row already is the cursor |
