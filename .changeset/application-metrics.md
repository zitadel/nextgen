---
"@zitadel/server": patch
---

The server now reports the metrics needed to explain a load result, through whichever exporter `instrumentation.metric` is configured with: storage statement duration by dialect and statement, connection pool use per dialect (PostgreSQL and SQLite), bearer credential validation, password verification and key chain resolution durations, audit insert duration, and counters for authentication outcomes, flow step transitions, token revocation checks and audit events written by type. No metric carries a user, project or request identifier, and the metric views drop any attribute an instrument does not declare. The API's request metrics are limited to the operation, method, route template and status code, so the raw request path can never become a time series. Every instrument and its attributes are listed in `docs/operations/metrics.md`.
