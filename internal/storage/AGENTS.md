# Storage Agent Instructions

These instructions apply to `internal/storage/` and may be refined by nearer
scoped `AGENTS.md` files.

## Storage Scope

- Storage is SQL-first. Prefer SQL-compatible modeling and query patterns.
- Supported databases are PostgreSQL and Spanner.
- Keep dialect-specific SQL behavior, query building, and migrations in
  `internal/storage/database/dialect/` (v1, interim on `new-repo`).
- Storage v2 lives in `internal/storage/v2/` and is the target dialect layer
  for `new-repo`. v1 dialect/repos are interim until the pre-merge checklist in
  [ADR 027](../../docs/adrs/027-storage-v2-statements-and-dialects.md) is complete.

## Sub-scoped Guidance

Read the nearest scoped file before changing repository code:

- `internal/storage/v2/AGENTS.md` — v2 statements, multi-write `withTransaction` rule
- `internal/storage/database/repository/AGENTS.md`
