# ADR 041: Storage Statement Contract Tests

> **Status:** Accepted
> **Date:** 2026-07-30
> **Context:** Multi-dialect SQL storage (PostgreSQL, Spanner, and SQLite)
> **Relates to:** [ADR 028](028-storage-v2-statements-and-dialects.md)

## Decision

Shared behavioral integration tests for v2 statement implementations live in
[`internal/storage/stmttest`](../../internal/storage/stmttest/). They
assert domain-visible behavior through [`service.AllStatements`](../../internal/service/statement.go),
not dialect SQL strings.

## Context

Per-dialect statement packages under `internal/storage/dialect/{postgres,spanner,sqlite}`
naturally grow near-duplicate integration tests. Those copies drift (coverage
gaps, fixture style), and they do not prove that every engine honors the same
service contract. Higher layers (services, API) cannot substitute for this
boundary without pulling in unrelated orchestration.

## How

- **Build-tag registration:** each dialect appends an opener under
  `postgres_integration`, `spanner_integration`, and/or `sqlite_integration`.
  `TestMain` brings up every registered dialect.
- **`forEachDialect`:** suite cases call `forEachDialect(t, fn)` so the body
  runs once per dialect as a subtest (`postgres`, `spanner`, `sqlite`); use
  normal `t.Run` for case names inside.
- **CI:** still one tag per job (`server:test-postgres` /
  `server:test-spanner` / `server:test-sqlite`). Locally, multiple tags may be
  set in one process.
- **Assertions:** domain fields, list/filter/cursor behavior, and typed
  integrity errors (`database.ForeignKeyError`, etc.). No live cross-dialect
  `cmp` of rows and no SQL string equality.
- **Dialect-local remains dialect-local:** compiler unit tests, migrations,
  `withTransaction` nesting, and DML helpers such as `SeedProjectsTiedAt`
  (needed when `CreateProject` cannot force a shared `created_at`).

## Consequences

- New portable statement behavior should gain a `stmttest` case (or extend an
  existing one) rather than only a dialect-package copy.
- Engine-specific proof stays next to the engine.
- Bring-up uses [`dbtest.Pool`](../../internal/storage/dbtest/dbtest.go)
  (`database.Pool` + `service.Pool`).
