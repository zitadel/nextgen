---
"@zitadel/server": minor
---

The server's traces now show a request that matches no API operation (a `404` or `405`) as a server span, and name each PostgreSQL query's verb (`SELECT`, `BEGIN`, `COMMIT`) in `db.operation.name`. A `pgx.acquire` span now appears only when a request waited a millisecond or more for a pooled connection. See [Tracing](https://github.com/zitadel/nextgen/blob/main/docs/quick-start/configuration.md#tracing).
