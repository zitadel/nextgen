# Metrics

What the server measures about itself, how each series is kept bounded, and how to read the numbers. The instruments
are declared in one place, [`internal/instrumentation/metrics/catalogue.go`](../../internal/instrumentation/metrics/catalogue.go);
the reference below is that list, and a test fails when the two disagree.

## Turning metrics on

Metrics go to whichever exporter `instrumentation.metric.exporter` selects (`NEXTGEN_INSTRUMENTATION_METRIC_EXPORTER_TYPE`):
`stdout`, `stderr`, `grpc`, `http`, `google`, `prometheus`, or `auto`, which reads the standard `OTEL_METRICS_EXPORTER`
and `OTEL_EXPORTER_OTLP_*` variables. With no exporter configured the application instruments are left off entirely:
nothing is recorded, and a storage statement does not look up its own name.
With one configured, recording costs well under a microsecond per statement.

`prometheus` registers the exporter with the process's default Prometheus registry and serves nothing by itself. To get
an endpoint out of the box, use `auto`:

```sh
export NEXTGEN_INSTRUMENTATION_METRIC_EXPORTER_TYPE=auto
export OTEL_METRICS_EXPORTER=prometheus     # serves /metrics on localhost:9464
export OTEL_EXPORTER_PROMETHEUS_PORT=9464   # optional
```

Prometheus names follow the OpenTelemetry convention: dots become underscores, a unit of `s` appends `_seconds`, a
counter appends `_total`, and curly-brace units are dropped. `zitadel.db.statement.duration` is
`zitadel_db_statement_duration_seconds`, and `zitadel.auth.attempt.outcomes` is `zitadel_auth_attempt_outcomes_total`.

## Bounded by construction

A series is created for every distinct combination of attribute values and lives as long as the process, so one
attribute that follows an id turns a load test into an out-of-memory. The rule is therefore absolute:

**No instrument carries a user, project, session, token, flow or request identifier, a request path, or anything else
that grows with the data.** Per-user and per-project views belong in traces and audit events, not in metrics.

Three layers enforce it:

1. **The recording API takes closed types.** Every `Record*` method of
   [`metrics.Application`](../../internal/instrumentation/metrics/application.go) takes an enum declared in the
   catalogue (`CredentialResult`, `AuthCheck`, ...), or a name fixed in code. A value outside a closed set is reported
   as `other`, whatever type it travelled in. A name fixed in code (a statement method, an event type) is capped at 512
   distinct values per attribute; later ones are reported as `other`, so a bug that feeds one something request-shaped
   costs one series, not one per request.
2. **The meter provider drops undeclared attributes.** [`zotel.MeterViews`](../../internal/instrumentation/zotel/meter.go)
   builds one view per catalogued instrument that allows only the attribute keys the catalogue lists. Code that records
   an extra attribute loses it before it can create a series.
3. **Tests assert both.** The metrics package drives every instrument with thousands of distinct values and asserts
   the series count; `zotel` runs the generated API server against 100,000 distinct `/users/{id}` paths and asserts a
   single series per operation.

### HTTP

The API's request instruments are the generated server's (`ogen.server.request_count`, `ogen.server.errors_count`,
`ogen.server.duration`, in milliseconds). They carry exactly:

| Attribute | Example | Meaning |
| --- | --- | --- |
| `oas.operation` | `GetUserByID` | OpenAPI operation id |
| `http.request.method` | `GET` | Method |
| `http.route` | `/users/{user_id}` | The route **template**, never the request path |
| `http.response.status_code` | `200` | Status |

The view that enforces this also covers `otelhttp`, should a handler ever be wrapped with it. The raw request path
(`http.target`, `url.path`) is not allowed on either: before this list existed it was, and a benchmark over 100,000
users would have made 100,000 series.

## Reading the numbers

- **Where did a request's time go?** `zitadel_db_statement_duration_seconds` by `statement` says which statement is slow
  and how often it runs. A statement the request issues thousands of times per second (the authorization check, the
  token record read) matters more than a slow one it issues once.
- **Is authentication the bottleneck?** `zitadel_auth_credential_validation_duration_seconds` is every authenticated
  request. Its time is the key chain (`zitadel_crypto_key_chain_resolution_duration_seconds`, only on a crypter cache
  miss) plus one `tokenStatements.GetTokenByID`. `zitadel_auth_password_verification_duration_seconds` is the deliberate
  cost of the password hash, per login.
- **Are the caches earning their keep?** `zitadel_cache_lookups_total` by `result` is the hit rate.
- **Is the pool saturated?** `zitadel_db_pool_connections` with `state="in_use"` close to the pool size, while
  statement durations climb, is waiting for a connection rather than slow SQL.
- **Is the audit trail keeping up?** `zitadel_audit_insert_duration_seconds` by `source`, and
  `zitadel_audit_events_written_total` by `type`.

### What the timings include

- A **statement** is timed for the whole call of the storage executor: for SQLite a call to `database/sql`, for Spanner
  the call including reading the rows and any abort retries, for PostgreSQL a `Query` until it returns and a `QueryRow`
  until its `Scan`. Waiting for a pooled connection is inside it. A statement that runs inside a transaction is timed
  too; the transaction's begin and commit are not statements. The statement name is the method that issued the call
  (`tokenStatements.GetTokenByID`); a helper such as a hydration step shows up under its own name
  (`userStatements.hydrateUserGroup`). A call issued by no statement method (a migration, a health check) is `unknown`.
- A **credential validation** is everything `IntrospectToken` does: key resolution, decryption, and the token record
  read. A credential that cannot be revoked is not checked against a record and is not a revocation check.
- A **key chain resolution** is the unwrap of one key that was not in the crypter cache. A key wrapped by a project KEK
  also resolves that KEK first, which is recorded as its own `master` resolution, so a cold project-wrapped key shows
  up once as `master` and once as `project`, and the `project` one includes the `master` one.
- An **audit insert** is one event in its own transaction (`event`) or one flush of the buffered `request.api` events
  (`request`, and one per retry attempt). `zitadel_audit_events_written_total` counts events handed to storage without
  an error; an event inserted in a transaction that later rolls back is still counted.
- A **flow transition** is one flow engine call (`start`, `submit`, or `render`) and where it left the flow. Step names
  are defined per project and are deliberately not an attribute.

Connection pool gauges cover PostgreSQL and SQLite. Spanner has no connection pool; its client reports its own session
pool metrics.

## Reference

### `zitadel.db.statement.duration`

Duration of one storage statement call, including any wait for a pooled connection.

- Type: histogram, unit: `s`

| Attribute | Values | Meaning |
| --- | --- | --- |
| `dialect` | `postgres`, `sqlite`, `spanner` | Storage dialect. |
| `statement` | fixed in code, at most 512 | Statement method, as `type.Method` (for example `tokenStatements.GetTokenByID`). Fixed in code; capped at 512 values. |

### `zitadel.db.pool.connections`

Connections of the database pool, by state. Not reported for Spanner, which has no connection pool.

- Type: updowncounter, unit: `{connection}`

| Attribute | Values | Meaning |
| --- | --- | --- |
| `dialect` | `postgres`, `sqlite`, `spanner` | Storage dialect. |
| `state` | `in_use`, `idle` | Connection state. |

### `zitadel.auth.credential.validation.duration`

Duration of validating a bearer credential: decrypting it, checking its claims and, for a revocable one, reading its token record.

- Type: histogram, unit: `s`

| Attribute | Values | Meaning |
| --- | --- | --- |
| `result` | `valid`, `revoked`, `invalid`, `error` | Outcome. |

### `zitadel.auth.password.verification.duration`

Duration of verifying a password against its stored hash.

- Type: histogram, unit: `s`

| Attribute | Values | Meaning |
| --- | --- | --- |
| `result` | `match`, `mismatch`, `error` | Outcome. |

### `zitadel.auth.attempt.outcomes`

Authentication proofs verified, by kind of proof and outcome.

- Type: counter, unit: `{proof}`

| Attribute | Values | Meaning |
| --- | --- | --- |
| `check` | `user`, `password`, `passkey`, `passkey_registration` | Kind of proof. |
| `result` | `success`, `rejected`, `error` | Outcome. |

### `zitadel.auth.token.revocation_checks`

Token record lookups made to see whether a credential was revoked. Credentials that cannot be revoked are not checked and not counted.

- Type: counter, unit: `{check}`

| Attribute | Values | Meaning |
| --- | --- | --- |
| `result` | `active`, `revoked`, `error` | Outcome. |

### `zitadel.crypto.key_chain.resolution.duration`

Duration of unwrapping an encryption key that was not in the crypter cache, including resolving any wrapping key that is not cached either. Reading the key row is a storage statement and is part of zitadel.db.statement.duration.

- Type: histogram, unit: `s`

| Attribute | Values | Meaning |
| --- | --- | --- |
| `kek` | `master`, `project` | What wraps the key. A project-wrapped resolution includes the time spent resolving its project KEK, which is recorded again as its own master-wrapped resolution. |

### `zitadel.flow.step.transitions`

Flow engine operations, by entry point and where they left the flow. Step names are defined per project and are deliberately not an attribute.

- Type: counter, unit: `{transition}`

| Attribute | Values | Meaning |
| --- | --- | --- |
| `operation` | `start`, `submit`, `render` | Flow engine entry point. |
| `result` | `step`, `complete`, `error` | Where the flow was left. |

### `zitadel.audit.insert.duration`

Duration of one audit insert: a single event in its transaction, or one flush of the buffered request events.

- Type: histogram, unit: `s`

| Attribute | Values | Meaning |
| --- | --- | --- |
| `source` | `request`, `event` | Route into storage. |

### `zitadel.audit.events.written`

Audit events handed to storage successfully, by event type. An event written inside a transaction that later rolls back is still counted.

- Type: counter, unit: `{event}`

| Attribute | Values | Meaning |
| --- | --- | --- |
| `type` | fixed in code, at most 512 | Event type, such as `auth.token.revoked`. Fixed in code; capped at 512 values. |

### `zitadel.cache.lookups`

Cache lookups, split into hits and misses.

- Type: counter, unit: `-`

| Attribute | Values | Meaning |
| --- | --- | --- |
| `cache` | fixed in code, at most 512 | Name of the cache, fixed in code (`crypter`, `signing_key`). |
| `result` | `hit`, `miss` | Outcome. |

### `zitadel.cache.evictions`

Entries dropped from a cache because it was full.

- Type: counter, unit: `-`

| Attribute | Values | Meaning |
| --- | --- | --- |
| `cache` | fixed in code, at most 512 | Name of the cache, fixed in code (`crypter`, `signing_key`). |

### `zitadel.cache.entries`

Entries currently held in a cache.

- Type: gauge, unit: `-`

| Attribute | Values | Meaning |
| --- | --- | --- |
| `cache` | fixed in code, at most 512 | Name of the cache, fixed in code (`crypter`, `signing_key`). |

