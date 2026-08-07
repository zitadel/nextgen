# ADR 027: Cursor-Based Pagination

> **Status:** Proposed
> **Date:** 2026-04-30
> **Context:** REST API list endpoints
> **Agreed:** Storage layer — pending API stakeholder review

## Decision

All list endpoints in this API use **cursor-based pagination** via `page_token` (request) and `next_page_token` (response) instead of offset/limit.

## Context

Offset-based pagination (`?offset=20&limit=20`) is simple to implement but breaks down at scale:

- **Inconsistent results:** rows inserted or deleted between pages cause items to be skipped or duplicated.
- **Expensive counts:** returning a `total` requires a full table scan.
- **No stable position:** the offset is meaningless if the result set changes.

Cursor-based pagination solves these by encoding the position of the last seen item into an opaque token. The server uses that position as a `WHERE (created_at, id) > (cursor_t, cursor_id)` predicate — stable, index-friendly, and consistent regardless of concurrent writes.

## Consequences

- List endpoints expose `page_token` as an optional query parameter and `next_page_token` in the response body. Absence of `next_page_token` means no further pages.
- `page_token` values are **opaque** — clients must not attempt to decode or construct them. The server signs tokens (e.g. HMAC) to detect tampering and may change the encoding between releases.
- No `total` count is returned. If a total is needed for a specific use case it should be a separate endpoint or query parameter.
- Existing endpoints that still use `offset`/`limit` (e.g. `GET /users`) are marked with a `TODO` comment and will be migrated. New list endpoints must use `page_token`.
- See `POST /sessions/query` as the reference implementation and `components/parameters/page-token.yaml` for the reusable parameter definition.
- Storage-layer keyset pagination is implemented in `internal/storage/v2/` via
  `ListOptions` and `CursorToken`; see [ADR 028](028-storage-v2-statements-and-dialects.md).
