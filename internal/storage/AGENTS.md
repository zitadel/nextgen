# Storage Agent Instructions

These instructions apply to `internal/storage/` and may be refined by nearer
scoped `AGENTS.md` files.

## Storage Scope

- Storage is SQL-first. Prefer SQL-compatible modeling and query patterns.
- Supported databases are PostgreSQL and Spanner.
- Keep dialect-specific SQL behavior, query building, and migrations in
  `internal/storage/database/dialect/` (v1, interim until the pre-merge
  checklist in
  [ADR 028](../../docs/adrs/028-storage-v2-statements-and-dialects.md) is
  complete).
- Storage v2 lives in `internal/storage/v2/` and is the target dialect layer.
  Entity persistence uses v2 statements; v1 dialects remain for pool,
  migrations, and related infrastructure until that checklist closes.

## Sub-scoped Guidance

Read the nearest scoped file before changing storage code:

- `internal/storage/v2/AGENTS.md` — v2 statements, multi-write `withTransaction` rule
