---
title: See what happened in a project in the console's Logs
summary: The console has a Logs screen with a project's audit events and API requests, newest first, with filters, a search, a drawer for each event, a live mode and an export.
date: 2026-11-11T06:25Z
cloud: true
pulls: [2940, 2954, 2965, 2966, 2974]
---

The console's new **Logs** screen lists a project's events, newest first. Pick a view (audit events, API requests or all), narrow it by time, category and type or status, and search by ID, operation, or a filter such as `actor:` or `resource:`.

- An event opens in a drawer over the list. ↑ and ↓ (or k and j) step through the rows, and an API request lists the events it caused.
- **Live** adds new events every few seconds, **My activity** shows what you did, and **Only failures** and **Only failed requests** show what went wrong.
- **Export** copies the loaded events, or downloads them as JSON or CSV.
- `GET /events` filters API requests by `operation_id` and `status_class`, and `zitadel events list` takes both as `--filter`.
- Platform operators see every project's events, unclaimed projects included.

**Upgrading:** a page of `GET /events` can now hold fewer events than `limit`, or none, and still carry `next_page_token`: follow it until a response has none. On a self-hosted Postgres server, the migration builds new indexes on `events` without blocking writes, and takes longer the more events you keep.

[The events API](https://preview.zitadel.com/docs/reference/api/events)
