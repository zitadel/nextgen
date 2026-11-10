---
"@zitadel/server": minor
"@zitadel/cli": patch
---

The console has a Logs screen: a project's events, newest first. Opening it swaps the sidebar for Logs' own list of views (audit events, API requests, all) and filters (time range, category, type, actor, resource, request, session, login flow), and a search field takes an ID or an event type. `GET /events` and `GET /events/{id}` now accept the console's session cookie. `GET /events` answers its filters from indexes instead of reading every event, and matches a combination no index holds over a bounded number of events per request: such a page can hold fewer events than `limit`, or none, and still carry `next_page_token` ([Events](https://preview.zitadel.com/docs/reference/api/events)). `zitadel events list` names the next page under an empty one.

**Upgrading:** the migration builds seven indexes on `events`. On Postgres it builds them without blocking writes, and takes longer the more events you keep. A client that stopped at the first short or empty page of `GET /events` must follow `next_page_token` until a response has none.
