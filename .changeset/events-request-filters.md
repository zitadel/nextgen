---
"@zitadel/server": minor
"@zitadel/cli": patch
---

`GET /events` filters API requests by `operation_id` and by `status_class` (`4xx` and `5xx` are the failed requests), and answers these and `entity_type` from an index, so their pages fill however many other events the project holds ([Events](https://preview.zitadel.com/docs/reference/api/events)). `zitadel events list` takes both as `--filter`. Requests recorded before the upgrade are not matched by the two new filters.

**Upgrading:** the migration adds two columns and three indexes to `events`. On Postgres it builds the indexes without blocking writes, and takes longer the more events you keep.
