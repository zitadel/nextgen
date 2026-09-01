# ADR 027: Cursor-Based Pagination

> **Status:** Implemented — 2026-08-11 (originally Proposed 2026-04-30)
> **Date:** 2026-04-30
> **Context:** REST API list endpoints
>
> **Amendment (2026-08-11):** shipped end to end. `POST /sessions/query` and
> `POST /teams/query` implement the structured-query + cursor contract,
> `GET /users` takes `limit` + `page_token`, and the storage layer implements
> keyset pagination via `ListOptions`/`CursorToken`. *(2026-08-22: `GET /schemas`,
> the last offset/limit holdout, now pages by cursor — #924.)*
> *(2026-08-26: `POST /users/query` joins the structured-query contract. It is
> the first one with no `project_id` parameter — the users list takes its
> project from the credential.)*

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
- Existing endpoints that still use `offset`/`limit` (e.g. `GET /users`) are marked with a `TODO` comment and will be migrated. New list endpoints must use `page_token`. *(2026-08-11: done for `GET /users`; 2026-08-22: done for `GET /schemas`, the last holdout — no offset parameter remains.)*
- See `POST /sessions/query` as the reference implementation and `components/parameters/page-token.yaml` for the reusable parameter definition.
- Storage-layer keyset pagination is implemented in `internal/storage/` via
  `ListOptions` and `CursorToken`; see [ADR 028](028-storage-v2-statements-and-dialects.md).
