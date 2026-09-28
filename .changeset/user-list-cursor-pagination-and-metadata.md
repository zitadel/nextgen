---
"@zitadel/server": minor
"@zitadel/api": minor
---

Every user the API returns now carries its `id` and a read-only `metadata`
object with `createdAt`, `updatedAt`, and `status` (`active`, `suspended`,
`deactivated`, or `pending_purge`). `GET /users`, `GET /users/{user_id}`, and
`GET /users/me` all serve this same typed `User` shape instead of an untyped
object, so the generated clients describe the fields rather than handing back a
free-form map.

Two changes to `GET /users` need action:

- Pagination moved from `offset` to `page_token`. Pass the `next_page_token`
  from the previous response instead of an offset; `offset` no longer exists.
  `limit` is unchanged.
- The response is an object — `{ "users": [...], "next_page_token": "..." }` —
  rather than a bare array, and users come back newest-first instead of
  oldest-first. `next_page_token` is absent on the last page.

`POST /users` now rejects a body that sets `id` or `metadata`; both are
server-owned.
