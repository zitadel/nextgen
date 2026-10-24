# Agent Instructions — `internal/storage/`

The rules in [`internal/AGENTS.md`](../AGENTS.md) apply here too, including
the one-database rule `stmttest` runs under.

## Scope

- Storage is SQL-first: prefer SQL-compatible modeling and query patterns.
- PostgreSQL, Spanner and SQLite are supported. SQLite is the zero-config
  local (and small homelab) default when no `database:` dialect is set; it is
  not a production peer to Spanner.
- Dialects (pool, migrations, statements) live under `dialect/`. `testdb`
  brings up Postgres and Spanner for integration tests (testcontainers or env
  DSNs).
- List a new package whose `spanner_integration` tests open a database in
  `server:test-spanner` (`apps/server/moon.yml` and its `package.json` twin).

## Identifier minting

Resource PKs are dialect-owned `prefix_<opaque>` values; the prefix registry
and the rules for a new prefix are in
[ADR 047](../../docs/adrs/047-dialect-id-generation.md).

- Create paths assign an empty ID with the dialect's `Ensure` /
  `ensureManagedID` before INSERT. Never invent IDs in domain, service or
  handlers.
- Pre-persist ceremonies (provisional user handle, passkey registration,
  in-memory flow and session handles) mint with
  `Statements().NewManagedID(prefix)`, the same generator.
- Empty → assign; non-empty → keep (ceremony, schema `$id`, fixtures). HTTP
  create never accepts a client-chosen resource PK.
- Never call `idgen` for a resource ID outside `internal/storage/dialect/`.

## Statements and transactions

Statement methods are tx-passive: they run on the `queryExecutor` they were
built with, a pool client or an open transaction.

- A statement method with two or more write round-trips (`Exec`, a write
  `QueryRow`, `Update`, `Write`) wraps them in its dialect's
  `withTransaction` ([postgres](dialect/postgres/with_transaction.go),
  [spanner](dialect/spanner/with_transaction.go),
  [sqlite](dialect/sqlite/with_transaction.go)) and uses the inner `tx` for
  every write, never `s.client` / `s.db`.
- A single SQL string, even a CTE or upsert touching many tables, is already
  atomic: do not wrap it.
- Never call `pool.Transaction` from a statement. `withTransaction` opens a
  transaction or joins the outer one (a Postgres savepoint, a Spanner no-op
  nest); `pool.Transaction` would take another Postgres connection or nest
  Spanner read-write transactions.
- Inside a transaction callback, keep the cause in the chain:
  `fmt.Errorf("...: %w", err)`, `fmt.Errorf("%w: %w", sentinel, err)`, or
  `domain.Err…(err)` / `.WithParent(err)`. `%v`, or a bare `domain.Err…()`
  while holding a cause, strips the gRPC status, and Spanner returns a
  retryable abort un-retried.
- Keep a callback replayable: a retry re-runs the whole closure, so make it a
  pure function of state captured before the transaction opened.
- `BatchWrite` and `NewReadWriteStmtBasedTransaction` do not retry `ABORTED`
  (`ReadWriteTransaction`, `Apply` and `PartitionedUpdate` do). Never adopt
  one without writing the retry loop.
- Never assemble statement SQL at the call site with `+` or `fmt.Sprintf`.
  Attach filters and arguments through `statementCompiler`: `compileRead`
  where a field schema exists, otherwise `WriteString` for the static base and
  `WriteArg` for each value. A package-level `const` holding one complete
  static statement is fine.

## Authz persistence

[`dialect/authz/`](dialect/authz/) holds the dialect-independent authz helpers
(ADRs 032–034; design in
[`permission-storage.md`](../../docs/design/api/permission-storage.md)); the
compiler and validator are in [`internal/authz/`](../authz/).

- A lifecycle path that touches users or team membership goes through the
  dual-write helpers ([`dual_write.go`](dialect/authz/dual_write.go)), which
  update the resource-scope index and `authz_membership_edges` in one
  transaction. Never write edges directly: a missed dual-write silently
  desynchronizes authorization from identity.
- Catalog rows ([`catalog_rows.go`](dialect/authz/catalog_rows.go)) map
  compiler mutations onto the catalog tables; `PersistCatalogVersion` stores
  catalog versions.
- Authz assignment IDs (`asgn_…`) mint like every other resource ID.
- The edge table keeps FK, CHECK and cascade parity across the three
  dialects; a behaviour change needs `stmttest` coverage.

## Statement contract tests

Dialect parity lives in [`stmttest`](stmttest/) (ADR 041): shared suites
assert through `service.AllStatements`, and `forEachDialect` loops the
dialects the build tags bring up (`postgres_integration`,
`spanner_integration`, `sqlite_integration`; several at once for local
parity).

- A domain-visible change under `dialect/{postgres,spanner,sqlite}/` (a new
  statement method, corrected error semantics such as `NoRowFoundError`, a
  filter, cascade or uniqueness contract) adds or extends a portable
  `forEachDialect` suite. Assert through `service.AllStatements` only, never
  dialect SQL.
- A new `List*` method seeds fixtures and calls `drainIncarnation` from
  `TestCursorBattle_DrainAllListIncarnations` (`stmttest/cursor_*`). A
  nullable sort column needs an extra drain case.
- A new schema joins the column lists of
  `stmttest/schema_nullability_test.go` (`sharedSchemaColumns`, or the
  dialect's `SchemaColumnNullability`), or its columns go unchecked.
- Dialect packages keep only engine-specific tests: compiler SQL shape, error
  wrapping, `withTransaction` nesting, migration and DDL smoke. If `stmttest`
  can assert it, it goes there.
- [`dbtest.Pool`](dbtest/dbtest.go) is the bring-up type.
