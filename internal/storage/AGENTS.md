# Storage Agent Instructions

These instructions apply to `internal/storage/` and may be refined by nearer
scoped `AGENTS.md` files.

## Storage Scope

- Storage is SQL-first. Prefer SQL-compatible modeling and query patterns.
- Supported databases are PostgreSQL and Spanner.
- Keep dialect-specific SQL behavior, query building, and migrations in
  `internal/storage/database/dialect/`.
- Storage v2 sketch lives in `internal/storage/v2/`; see
  [docs/design/storage-v2.md](../../docs/design/storage-v2.md). v1 remains the
  production path until entities are migrated.

## Sub-scoped Guidance

Read the nearest scoped file before changing repository code:

- `internal/storage/database/repository/AGENTS.md`
