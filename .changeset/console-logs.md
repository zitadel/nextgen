---
"@zitadel/server": minor
---

The console has a Logs screen: a project's events, newest first. Opening it swaps the sidebar for Logs' own list of views (audit events, API requests, all) and filters (time range, category, type, actor, resource, request, session, login flow), and a search field takes an ID or an event type. `GET /events` and `GET /events/{id}` now accept the console's session cookie, and `GET /events` answers those filters from an index instead of reading every event ([Events](https://preview.zitadel.com/docs/reference/api/events)).

**Upgrading:** the migration builds seven indexes on `events`. On Postgres it builds them without blocking writes, and takes longer the more events you keep.
