# Storage v2 Agent Instructions

These instructions apply to `internal/storage/v2/` and may be refined by nearer
scoped `AGENTS.md` files.

## Statements And Transactions

Statement methods are tx-passive: they run on whatever `queryExecutor` they were
built with (pool client or an open transaction).

### Multi-write rule

If a statement method issues **two or more** separate write round-trips
(`Exec` / write `QueryRow` / `Update` / `Write`), it **must** wrap those writes
in the dialect helper:

- Postgres: [`withTransaction`](dialect/postgres/with_transaction.go)
- Spanner: [`withTransaction`](dialect/spanner/with_transaction.go)

Inside the callback, use the **inner** `tx` for every write — never the outer
`s.client` / `s.db`.

A **single** SQL string (including a CTE or upsert that touches many tables) is
already atomic at the database; do not wrap it.

### Do not call `pool.Transaction` from statements

Service / pool `Transaction` opens the multi-entity boundary. Statement methods
must use `withTransaction` so they:

- open a transaction when called via `pool.Statements()`, and
- **join** an outer tx (Postgres savepoint; Spanner no-op nest) when already
  inside `pool.Transaction`.

Calling `pool.Transaction` from a statement would use a different Postgres
connection or nest Spanner RW transactions (forbidden).

### Reference

Multi-write nesting uses the dialect `withTransaction` helpers above
([`dialect/postgres/with_transaction.go`](dialect/postgres/with_transaction.go),
[`dialect/spanner/with_transaction.go`](dialect/spanner/with_transaction.go)).

## Statement contract tests

Behavioral statement parity across dialects lives in
[`stmttest`](stmttest/) (see ADR 041). Shared suites assert through
`service.AllStatements`; build-tagged registration brings up postgres and/or
spanner, and `forEachDialect` loops dialects. CI still runs one tag per job; both
tags are supported in one process for local parity checks.

[`dbtest.Pool`](dbtest/dbtest.go) is the migrated bring-up type
(`database.Pool` + `service.Pool`). Dialect packages keep engine-specific
tests (compiler SQL shape, error wrapping, `withTransaction` nesting,
migrations). Cursor-tie project seeding uses dialect
`SeedProjectsTiedAt` helpers under the integration build tags.
