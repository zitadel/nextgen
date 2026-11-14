---
"@zitadel/server": minor
---

Every request now has one server span, covering all of its middleware: a `404`, a `405` and the paths outside the API were untraced before. Each PostgreSQL query span names its verb (`SELECT`, `BEGIN`, `COMMIT`) in `db.operation.name`, and a `pgx.acquire` span appears only for a wait of a millisecond or more for a pooled connection. See [Tracing](https://github.com/zitadel/nextgen/blob/main/docs/quick-start/configuration.md#tracing).
