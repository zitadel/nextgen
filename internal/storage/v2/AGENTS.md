# Storage v2 Agent Instructions

These instructions apply to `internal/storage/v2/` and may be refined by nearer
scoped `AGENTS.md` files.

## Identifier minting

Resource PKs are dialect-owned `prefix_<opaque>` values
([ADR 047](../../../docs/adrs/047-dialect-id-generation.md)).

- **Create paths:** assign empty IDs with dialect `Ensure` /
  `ensureManagedID` before INSERT. Do not invent IDs in domain, service, or
  handlers.
- **Pre-persist ceremony** (provisional user handle, passkey registration,
  in-memory flow/session handles): mint with `Statements().NewManagedID(prefix)`
  (same generator as `Ensure`).
- **Empty → assign; non-empty → keep** (ceremony / schema `$id` / fixtures).
  HTTP create must not accept a client-chosen resource PK.
- Do **not** call `idgen` from outside `internal/storage/v2/dialect/`.
- Prefix registry and selection rules for new prefixes live in ADR 047.

## Statements And Transactions

Statement methods are tx-passive: they run on whatever `queryExecutor` they were
built with (pool client or an open transaction).

### Multi-write rule

If a statement method issues **two or more** separate write round-trips
(`Exec` / write `QueryRow` / `Update` / `Write`), it **must** wrap those writes
in the dialect helper:

- Postgres: [`withTransaction`](dialect/postgres/with_transaction.go)
- Spanner: [`withTransaction`](dialect/spanner/with_transaction.go)
- SQLite: [`withTransaction`](dialect/sqlite/with_transaction.go)

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

### Never flatten the cause of an error returned from a transaction

Spanner aborts read-write transactions under concurrency, and
`ReadWriteTransaction` retries them for you — but only while it can still find
the gRPC status in the error your callback returns. It looks for a
`*spanner.Error` or a `status.FromError` match; anything else it returns
immediately, un-retried.

So inside a transaction callback, always keep the cause in the chain:

- `fmt.Errorf("...: %w", err)`, or `fmt.Errorf("%w: %w", sentinel, err)` when you
  also need a domain sentinel to stay matchable.
- `domain.Err…(err)` / `.WithParent(err)`, never a bare `domain.Err…()` when you
  are holding a real cause.

Writing `fmt.Errorf("%w: %v", sentinel, err)` strips the status off `err` and
silently converts a retryable abort into a user-facing error. That was the cause
of the CI flake in #788.

For the same reason, a transaction callback must be **replayable**: a retry
re-runs the whole closure, so keep it a pure function of state captured before
the transaction opened.

### These Spanner client methods do not retry ABORTED

`ReadWriteTransaction`, `Apply` and `PartitionedUpdate` retry aborts internally.
`BatchWrite` and `NewReadWriteStmtBasedTransaction` do **not** — they are
caller-retried by design. Nothing uses them today; do not adopt one without
writing the retry loop yourself.

### Reference

Multi-write nesting uses the dialect `withTransaction` helpers above
([`dialect/postgres/with_transaction.go`](dialect/postgres/with_transaction.go),
[`dialect/spanner/with_transaction.go`](dialect/spanner/with_transaction.go),
[`dialect/sqlite/with_transaction.go`](dialect/sqlite/with_transaction.go)).

### No call-site SQL concatenation

Do not assemble statement SQL at the call site with `+` or `fmt.Sprintf`
(for example `baseQuery + " WHERE …"`). Attach filters and bind arguments only
through `statementCompiler`:

- Prefer `compileRead` when a field schema exists (Get-by-ID and List).
- For JOIN selects without a matching schema (auth-attempt gets), use
  `WriteString` for the static base and `WriteArg` for each bound value.

Package-level `const` values that are one complete static statement remain
allowed (including adjacent string literals / `+` only for line wrapping).
Compiler-internal `WriteString(" WHERE ")` on a `statementCompiler` is the
supported path for dynamic filters.

## Statement contract tests

Behavioral statement parity across dialects lives in
[`stmttest`](stmttest/) (see ADR 041). Shared suites assert through
`service.AllStatements`; build-tagged registration brings up postgres, spanner,
and/or sqlite, and `forEachDialect` loops dialects. CI still runs one tag per
job; multiple tags are supported in one process for local parity checks.

**When you add or fix dialect statement or schema behavior** under
`dialect/{postgres,spanner,sqlite}/`, you **must** add or extend a portable
`forEachDialect` suite in [`stmttest/`](stmttest/) for any domain-visible
change: new statement methods, corrected error semantics (for example
`NoRowFoundError`), and filter / cascade / uniqueness contracts that statements
rely on. Assert through `service.AllStatements` only — no dialect SQL.

Dialect packages keep **engine-specific** tests only: compiler SQL shape, error
wrapping, `withTransaction` nesting, and migration/DDL smoke. Do not duplicate
upward: if `stmttest` can assert the behavior, put it there — not a per-dialect
copy of the same scenario.

Bring-up tags: `postgres_integration`, `spanner_integration`,
`sqlite_integration`.

[`dbtest.Pool`](dbtest/dbtest.go) is the migrated bring-up type
(`database.Pool` + `service.Pool`). Cursor-tie project seeding uses dialect
`SeedProjectsTiedAt` helpers under the integration build tags.
