# Storage Agent Instructions

These instructions apply to `internal/storage/` and may be refined by nearer
scoped `AGENTS.md` files.

## Storage Scope

- Storage is SQL-first. Prefer SQL-compatible modeling and query patterns.
- Supported databases are PostgreSQL and Spanner.
- Dialect implementations (pool, migrations, embedded bring-up, statements)
  live under `internal/storage/v2/dialect/`.
- Storage v2 (`internal/storage/v2/`) is the active dialect and statements
  layer. Entity persistence uses v2 statements exclusively.
- The legacy v1 package `internal/storage/database/` (query-builder, dialects,
  repositories, aliases) has been removed. Do not reintroduce it.

## Sub-scoped Guidance

Read the nearest scoped file before changing storage code:

- `internal/storage/v2/AGENTS.md` — v2 statements, multi-write `withTransaction` rule
