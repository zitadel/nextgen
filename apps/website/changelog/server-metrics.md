---
title: Metrics for a self-hosted server's API, database and sign-ins
summary: A self-hosted server reports metrics for its database, its credential and password checks, its flows and its audit writes, and its API request metrics no longer make a series per id.
date: 2026-10-28T10:20Z
cloud: true
pulls: [2337, 2338, 2339, 1468]
---

A server reports more through `instrumentation.metric`, and the configuration guide's Metrics section lists every instrument with its attributes and their values.

- **API requests:** `ogen.server.request_count`, `ogen.server.errors_count` and `ogen.server.duration` now carry only the operation, method, route template and status code, so a request path with an id in it no longer becomes a time series of its own.
- **Database:** `db.client.operation.duration` times every storage statement, labelled with the database and the statement method that issued it, and `db.client.connection.count` and `db.client.connection.max` report the PostgreSQL and SQLite connection pools by state.
- **Authentication:** how long validating a bearer credential takes and whether it was valid, revoked, invalid or failed; how long verifying a password takes and whether it matched, matched and was rehashed, or did not match; the outcome of every authentication proof by kind of check; and how long resolving an encryption key not in the cache takes.
- **Flows and audit:** where every flow start, submit and render left the flow, and how long audit inserts take, with the events written counted per type.
- Every instrument keeps at most 2000 series; past that, new attribute combinations are counted on one series marked `otel.metric.overflow=true`.

The server now reports a failure to flush traces, metrics and logs when it shuts down, instead of dropping them silently, and exits with code 1, also on a planned stop, for example when the OpenTelemetry collector is unreachable. Log lines written inside a sampled trace carry its trace and span ID when `instrumentation.log.format` is not set.

[Metrics in the configuration guide](https://github.com/zitadel/nextgen/blob/main/docs/quick-start/configuration.md#metrics)
