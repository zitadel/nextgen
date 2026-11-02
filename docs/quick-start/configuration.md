# Configuration

The server loads settings from a YAML file, environment variables, or both. Environment variables use the `NEXTGEN_`
prefix and nested keys use underscores.

Example file: [`docs/operations/nextgen.example.yaml`](../operations/nextgen.example.yaml).

## Server

| YAML key                 | Environment                      | Default                                                             | Description                                                                                            |
| ------------------------ | -------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `server.address`         | `NEXTGEN_SERVER_ADDRESS`         | `:8080`                                                             | Listen address                                                                                         |
| `server.data_dir`        | `NEXTGEN_SERVER_DATA_DIR`        | `nextgen-data` next to the binary                                   | Local runtime data root                                                                                |
| `server.master_keys`     | — (YAML only)                    | auto-generated RSA master key under `<server.data_dir>/master-keys` | Master keys that wrap each project's key encryption key (KEK); see [Encryption keys](#encryption-keys) |
| `server.generate_master_key` | `NEXTGEN_SERVER_GENERATE_MASTER_KEY` | `true`                                                          | Mint a master key when none is configured and the master key directory is empty; `false` (or `--disable-master-key-generation`) fails the start instead |
| `server.console_enabled` | `NEXTGEN_SERVER_CONSOLE_ENABLED` | `true`                                                              | Serve embedded management console                                                                      |
| `server.console_path`    | `NEXTGEN_SERVER_CONSOLE_PATH`    | `/ui/console`                                                       | Console URL prefix                                                                                     |
| `server.public_base`     | `NEXTGEN_SERVER_PUBLIC_BASE`     | `https://nextgen.zitadel.cloud`                                     | Public origin browsers reach this deployment at; feeds the claim and dashboard URLs. Set to `http://localhost:8080` when running the server locally by hand; the CLI runtime (`zitadel start`) sets it itself. With platform bootstrap on, it is the platform project's one primary origin, so servers sharing a database need the same value. |
| `server.console_origins` | `NEXTGEN_SERVER_CONSOLE_ORIGINS` | — (none) | Other origins the console is reached at, beside the origin of `server.public_base`, such as another hostname in front of the deployment. Like that origin, they may open any project's flow to preview its login; signing in to the platform project works only at `server.public_base`. A comma-separated list in the environment. |
| `server.request_id_header` | `NEXTGEN_SERVER_REQUEST_ID_HEADER` | — (unset)                                                      | A header a proxy in front of the server sets to its own ID for each request, such as Vercel's `x-vercel-id`. The server then uses that ID in its logs, `X-Request-Id`, audit events and error pages. Set it only behind a proxy that overwrites the header, or a client chooses its own ID. |

## Platform

| YAML key                     | Environment                          | Default | Description                                                                                                                                            |
| ----------------------------- | ------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `platform.bootstrap_project` | `NEXTGEN_PLATFORM_BOOTSTRAP_PROJECT`  | `false` | Provisions the well-known platform project (encryption/signing keys, default user schema, default login flow) at startup. Needed for `zitadel claim` and self-registration to work on this deployment. `zitadel start` turns it on itself; set it to `false` to opt out of the platform project and the local admin.   |
| `platform.operators`         | `NEXTGEN_PLATFORM_OPERATORS`          | (empty) | User ids, comma-separated in the environment, of the platform-project users who administer every project of the deployment ([ADR 075](../adrs/075-platform-operators.md)). Reconciled at every start: listed users that exist are granted, and those an earlier list granted are revoked. Needs a platform project (`bootstrap_project` or `project_id`). |
| `platform.project_id`        | `NEXTGEN_PLATFORM_PROJECT_ID`         | (empty) | Pins an existing project as the standalone Console's sign-in target, overriding the first-created-project fallback. Does **not** provision the platform project or enable claiming, self-registration, or personal teams — only `bootstrap_project` does that. Mutually exclusive with `bootstrap_project` unless set to its built-in id. Transitional ([Console ADR 0004](../../apps/console/docs/adrs/0004-console-deployment-modes.md)); expect it to be removed once bootstrap always provisions the platform project. |

On a server you start by hand (Docker Compose, or the Go binary), set both to
make claiming work against that deployment:

```sh
export NEXTGEN_PLATFORM_BOOTSTRAP_PROJECT=true
export NEXTGEN_SERVER_PUBLIC_BASE=http://localhost:8080
```

A runtime started by `zitadel start` needs neither: the CLI sets both values
itself and creates a local admin you reach with `zitadel console`.

## Database

Configure exactly one dialect under `database:`, or omit it for the local
default.

| Backend        | When to use                                                        | Config key / env                                  |
| -------------- | ------------------------------------------------------------------ | ------------------------------------------------- |
| **SQLite**     | Local development, CLI binary runtime, small single-node / homelab | `database.sqlite` / `NEXTGEN_DATABASE_SQLITE`     |
| **PostgreSQL** | Production and Docker Compose                                      | `database.postgres` / `NEXTGEN_DATABASE_POSTGRES` |
| **Spanner**    | Production on Google Cloud Spanner                                 | `database.spanner` / `NEXTGEN_DATABASE_SPANNER`   |

When `database:` is omitted, the server uses **SQLite** at
`<server.data_dir>/zitadel.db` (local / homelab default).

Override examples:

```yaml
database:
  sqlite: ./nextgen-data/zitadel.db
```

```yaml
database:
  postgres: postgres://zitadel:zitadel@localhost:5432/nextgen?sslmode=disable
```

```yaml
database:
  spanner: projects/PROJECT/instances/INSTANCE/databases/DATABASE
```

Or via environment:

```sh
export NEXTGEN_DATABASE_SQLITE='./nextgen-data/zitadel.db'
# or
export NEXTGEN_DATABASE_POSTGRES='postgres://zitadel:zitadel@localhost:5432/nextgen?sslmode=disable'
# or
export NEXTGEN_DATABASE_SPANNER='projects/PROJECT/instances/INSTANCE/databases/DATABASE'
```

SQLite is intended for local development and small single-node deployments
(single-writer limits apply). Use PostgreSQL or Spanner for production.
`IgnoreCase` string filters use SQLite's `LOWER()`, which only folds ASCII —
non-ASCII case folding (for example `Ü`/`ü`) can diverge from Postgres.
Spanner authentication uses Application Default Credentials (ADC); this guide
does not cover IAM setup.

Migrations run automatically when the server starts.

## Sessions

| YAML key              | Environment                   | Default          | Description                                                                                      |
| --------------------- | ----------------------------- | ---------------- | ------------------------------------------------------------------------------------------------ |
| `session.default_ttl` | `NEXTGEN_SESSION_DEFAULT_TTL` | `24h`            | How long a session lasts after a completed sign-in, when the sign-in does not ask for a lifetime |
| `session.max_ttl`     | `NEXTGEN_SESSION_MAX_TTL`     | `720h` (30 days) | Longest lifetime a sign-in may ask for. `default_ttl` must not exceed it                         |

Both take Go durations (`90m`, `24h`, `168h`); there is no unit for days.

The lifetime starts when the sign-in completes (`POST /sessions/exchange`). Using the session does not extend it. When
it runs out, the session cookie stops working, `GET /sessions/me` answers `401`, and the user signs in again. A sign-in
can ask for another lifetime with the `ttl` field of the exchange, up to `session.max_ttl`; the SDKs do not set it.

An anonymous session, which a client can create before anyone signs in (`POST /sessions`), lasts 10 minutes. This is
not configurable. When a sign-in completes on that session, it gets the full lifetime above.

```yaml
session:
  default_ttl: 168h # a week
  max_ttl: 720h
```

## Audit event retention

| YAML key                          | Environment                               | Default          | Description                                                    |
| --------------------------------- | ----------------------------------------- | ---------------- | -------------------------------------------------------------- |
| `events.retention.enabled`        | `NEXTGEN_EVENTS_RETENTION_ENABLED`        | `true`           | Delete audit events once they are older than the window        |
| `events.retention.window`         | `NEXTGEN_EVENTS_RETENTION_WINDOW`         | `720h` (30 days) | How long an event is kept after it was stored                  |
| `events.retention.interval`       | `NEXTGEN_EVENTS_RETENTION_INTERVAL`       | `1h`             | How often the server purges; the first purge runs as it starts |
| `events.retention.trigger_secret` | `NEXTGEN_EVENTS_RETENTION_TRIGGER_SECRET` | (empty)          | Leaves the schedule to a scheduler outside the server (below)  |

The server purges on its own timer. A server that runs only while it serves a
request, such as a Vercel function, can't keep a timer. Set `trigger_secret`
to at least 16 printable ASCII characters (`openssl rand -hex 32`), and the
server stops its timer and purges once per `GET` or `POST` to
`/cron/events-retention` that carries the secret as a bearer token:

```sh
curl -fsS -H "Authorization: Bearer $TRIGGER_SECRET" https://zitadel.example.com/cron/events-retention
# {"deleted":42}
```

- A request without the secret gets `401`, and a purge that fails `500`; the
  server's log says why.
- A purge that takes longer than 4½ minutes is cancelled and deletes nothing,
  so give the call that long.
- A missed call leaves its events to the next. Two calls at once are safe: the
  second deletes what the first left, or nothing.

The hosted cloud calls it from a Vercel Cron Job
([runbook](../runbooks/cloud.md#operating)).

## Logging

| YAML key                                     | Environment                                          | Default                                       | Description                                                 |
| -------------------------------------------- | ---------------------------------------------------- | --------------------------------------------- | ----------------------------------------------------------- |
| `instrumentation.log.level`                  | `NEXTGEN_INSTRUMENTATION_LOG_LEVEL`                  | `info`                                        | Minimum log level                                           |
| `instrumentation.log.format`                 | `NEXTGEN_INSTRUMENTATION_LOG_FORMAT`                 | `text`                                        | Log output encoding                                         |
| `instrumentation.log.streams`                | `NEXTGEN_INSTRUMENTATION_LOG_STREAMS`                | `[runtime, ready, request, service, storage]` | Which log streams are enabled                               |
| `instrumentation.log.add_source`             | `NEXTGEN_INSTRUMENTATION_LOG_ADD_SOURCE`             | `true`                                        | Record the file and line that wrote each log line on stderr |
| `instrumentation.log.errors.report_location` | `NEXTGEN_INSTRUMENTATION_LOG_ERRORS_REPORT_LOCATION` | `true`                                        | Record where each error was created                         |
| `instrumentation.log.errors.stack_trace`     | `NEXTGEN_INSTRUMENTATION_LOG_ERRORS_STACK_TRACE`     | `false`                                       | Capture a stack trace when an error is created              |

`level`, `format`, and each entry of `streams` accept either their documented
string name (below) or the underlying numeric value; string values are
resolved case-insensitively via each type's `encoding.TextUnmarshaler`.

- `level`: `debug`, `info`, `warn`, `error` (`zlog.Level` is `slog.Level`
  under the hood, so an offset suffix like `warn+4` is also accepted; the
  GCP-only severities — notice, critical, alert, emergency — have no string
  form and must be set by their numeric value).
- `format`: `disabled`, `text`, `json`, `gcp`, `gcp_error_reporting`.
- `streams`: `runtime`, `ready`, `request`, `service`, `storage`.

`errors.report_location` and `errors.stack_trace` feed the error line that the
server logs once per failed API call. Location is one `runtime.Caller` and is
cheap. A stack is one `debug.Stack()` per error and is expensive on busy
servers. The error line includes it only at `error` level, so 4xx answers
never carry one there; other log lines that carry a `domain.Error` include it
whenever it was captured. Stack capture is off by default. The location and
the request id already point at the line where the error was created and at
the request that failed, so turn it on only while debugging a problem.

```yaml
instrumentation:
  log:
    level: debug
    format: json
    streams: [request, service]
    errors:
      report_location: true
      stack_trace: true
```

## Tracing

| YAML key                                        | Environment                                             | Default | Description                                    |
| ----------------------------------------------- | ------------------------------------------------------- | ------- | ---------------------------------------------- |
| `instrumentation.trace.exporter.type`           | `NEXTGEN_INSTRUMENTATION_TRACE_EXPORTER_TYPE`           | unset   | Where spans are sent                           |
| `instrumentation.trace.exporter.endpoint`       | `NEXTGEN_INSTRUMENTATION_TRACE_EXPORTER_ENDPOINT`       | unset   | Collector address for `grpc` and `http`        |
| `instrumentation.trace.exporter.insecure`       | `NEXTGEN_INSTRUMENTATION_TRACE_EXPORTER_INSECURE`       | `false` | Plain-text connection for `grpc` and `http`    |
| `instrumentation.trace.exporter.batch_duration` | `NEXTGEN_INSTRUMENTATION_TRACE_EXPORTER_BATCH_DURATION` | unset   | Longest wait before buffered spans are sent    |
| `instrumentation.trace.fraction`                | `NEXTGEN_INSTRUMENTATION_TRACE_FRACTION`                | `1.0`   | Share of incoming requests that are traced     |
| `instrumentation.trace.trust_remote_spans`      | `NEXTGEN_INSTRUMENTATION_TRACE_TRUST_REMOTE_SPANS`      | `false` | Continue the caller's trace from `traceparent` |

- `exporter.type`: `none`, `stdout`, `stderr`, `grpc`, `http`, `google` (set
  `exporter.google_project_id`), `auto`.
- Spans are exported only when an exporter type is set and is not `none`.
  Without an exporter, requests are still sampled at `fraction` and get trace
  and span IDs, so exported log records can still be grouped by request. The
  spans themselves are dropped.
- `auto` reads the standard OpenTelemetry environment variables
  (`OTEL_TRACES_EXPORTER`, `OTEL_EXPORTER_OTLP_ENDPOINT`, and the others). When
  none of them is set, no spans are exported.
- Always set `exporter.batch_duration` together with an exporter. Left unset,
  it is zero, and the exporter keeps one CPU core busy even when the server
  is idle.
- A traced request keeps all of its spans, including one span per database
  statement.

With `trust_remote_spans` off (the default), an incoming `traceparent`,
`tracestate` or `baggage` header is ignored and every request starts a new
trace, sampled by `fraction`.

With it on, the server span becomes a child of the caller's span and joins the
caller's trace ID. That also trusts the caller's sampled flag: a caller that
sends `sampled=1` is recorded and exported **whatever `fraction` says**, and
so is everything ZITADEL does for that request. A caller that sends
`sampled=0` is still sampled by `fraction`. Turn it on only when ZITADEL sits
behind a proxy, gateway or mesh you control that strips or overwrites these
headers at the edge, never when untrusted callers can reach ZITADEL directly,
because any of them could force every request to be recorded. The decision is
recorded in [ADR 080](../adrs/080-incoming-trace-context.md).

```yaml
instrumentation:
  trace:
    fraction: 0.01
    exporter:
      type: grpc
      endpoint: otel-collector:4317
      insecure: true
      batch_duration: 5s
```

## Metrics

| YAML key                                            | Environment                                                 | Default | Description                                     |
| --------------------------------------------------- | ----------------------------------------------------------- | ------- | ----------------------------------------------- |
| `instrumentation.metric.exporter.type`              | `NEXTGEN_INSTRUMENTATION_METRIC_EXPORTER_TYPE`              | unset   | Where metrics are sent                          |
| `instrumentation.metric.exporter.endpoint`          | `NEXTGEN_INSTRUMENTATION_METRIC_EXPORTER_ENDPOINT`          | unset   | Collector address for `grpc` and `http`         |
| `instrumentation.metric.exporter.insecure`          | `NEXTGEN_INSTRUMENTATION_METRIC_EXPORTER_INSECURE`          | `false` | Plain-text connection for `grpc` and `http`     |
| `instrumentation.metric.exporter.batch_duration`    | `NEXTGEN_INSTRUMENTATION_METRIC_EXPORTER_BATCH_DURATION`    | `60s`   | Interval between exports for push exporters     |
| `instrumentation.metric.exporter.google_project_id` | `NEXTGEN_INSTRUMENTATION_METRIC_EXPORTER_GOOGLE_PROJECT_ID` | unset   | Google Cloud project for the `google` exporter  |

- `exporter.type`: `none`, `stdout`, `stderr`, `grpc`, `http`, `google` (set
  `exporter.google_project_id`), `prometheus`, `auto`.
- Metrics are exported only when an exporter type is set and is not `none`.
  Without one, nothing is recorded: every instrument reports itself disabled,
  and the code that would measure a statement skips the work. With one, every
  statement pays the stack walk that names it, a clock read and a histogram
  record, on every request, whether tracing samples it or not.
- `auto` reads the standard OpenTelemetry environment variables
  (`OTEL_METRICS_EXPORTER`, `OTEL_EXPORTER_OTLP_ENDPOINT`, and the others).
  When none of them is set, no metrics are exported.
- `prometheus` registers the exporter with the process's default Prometheus
  registry and serves no endpoint by itself. For a scrape endpoint out of the
  box, use `auto` with `OTEL_METRICS_EXPORTER=prometheus`: that serves
  `/metrics` on `localhost:9464`, or on the host and port
  `OTEL_EXPORTER_PROMETHEUS_HOST` and `OTEL_EXPORTER_PROMETHEUS_PORT` name.
- `exporter.batch_duration` is how often a push exporter (`stdout`, `stderr`,
  `grpc`, `http`, `google`) sends what it collected. Left unset, the
  OpenTelemetry default applies: `OTEL_METRIC_EXPORT_INTERVAL`, or 60 seconds.
  `prometheus` is scraped and ignores it. `auto` ignores it too: an OTLP
  exporter it picks sends at `OTEL_METRIC_EXPORT_INTERVAL`, and its Prometheus
  exporter is scraped.

```yaml
instrumentation:
  metric:
    exporter:
      type: grpc
      endpoint: otel-collector:4317
      insecure: true
      batch_duration: 30s
```

### What is measured

Every instrument carries only what is listed here. No attribute identifies a
user, project, session, token or request, and the attributes marked "fixed in
code" take names from the code (a statement method, an event type, a cache),
never from data. The API's request instruments (`ogen.server.request_count`,
`ogen.server.errors_count` and `ogen.server.duration`, which records in
milliseconds with the SDK's default buckets) carry
the operation (`oas.operation`), the method (`http.request.method`), the
route template (`http.route`, as in `/users/{user_id}`) and the status
(`http.response.status_code`), never the request path. A request that
reached its operation at the root path rather than under `/api/v1`, which the
API answers until 1.0.0, also carries `zitadel.api.root_path` (`true`).
Should an attribute ever follow the data anyway, each instrument holds at most 2000 series: past
that, new attribute combinations land on one series marked
`otel.metric.overflow=true` instead of becoming series of their own. The
limit is the OpenTelemetry SDK's default; `OTEL_GO_X_CARDINALITY_LIMIT`
changes it.

The instruments below record durations in seconds, with buckets from 100µs
to 60s. In
Prometheus, a dot becomes an underscore, a duration gets a `_seconds` suffix
and a counter a `_total` suffix: `db.client.operation.duration` is
`db_client_operation_duration_seconds`, and `zitadel.auth.attempt.outcomes`
is `zitadel_auth_attempt_outcomes_total`.

| Instrument | Type | Unit | Attributes | What it measures |
| --- | --- | --- | --- | --- |
| `db.client.operation.duration` | histogram | `s` | `db.system.name`: `postgresql`, `sqlite`, `gcp.spanner`; `db.query.summary`: fixed in code | Duration of one storage statement call, including any wait for a pooled connection. PostgreSQL and SQLite time a query until it returns, before its rows are read, and PostgreSQL a single-row read until it is scanned; Spanner times a statement including the callback that reads its rows. With a metric exporter configured, every statement pays for this: the stack walk that names it, a clock read and a histogram record, on every request, whether tracing samples it or not. |
| `db.client.connection.count` | updowncounter | `{connection}` | `db.client.connection.pool.name`: `postgres`, `sqlite`; `db.client.connection.state`: `idle`, `used` | Connections of a database pool, by state. |
| `db.client.connection.max` | updowncounter | `{connection}` | `db.client.connection.pool.name`: `postgres`, `sqlite` | The most connections a database pool will open. |
| `zitadel.auth.credential.validation.duration` | histogram | `s` | `result`: `valid`, `revoked`, `invalid`, `error` | Duration of validating a bearer credential: decrypting it, checking its claims and, for a revocable one, reading its token record. |
| `zitadel.auth.token.revocation_checks` | counter | `{check}` | `result`: `active`, `revoked`, `error` | Token record lookups made to see whether a credential was revoked. Credentials that cannot be revoked, or that carry no token id, are not checked and not counted. |
| `zitadel.auth.password.verification.duration` | histogram | `s` | `purpose`: `login`, `history`; `result`: `match`, `updated`, `mismatch`, `error` | Duration of verifying a password against its stored hash. `updated` is a match on a hash outdated for the project's method, so the verify also computed (or attempted) a new hash: two hashes for one sign-in; it occurs for the `login` purpose only. |
| `zitadel.auth.attempt.outcomes` | counter | `{proof}` | `check`: `user`, `password`, `passkey`, `passkey_registration`; `result`: `success`, `rejected`, `error` | Authentication proofs verified through auth attempts, by kind of proof and outcome. SSO sign-ins are not counted. |
| `zitadel.crypto.key_chain.resolution.duration` | histogram | `s` | `key.kind`: `master`, `project` | Duration of unwrapping an encryption key that was not in the crypter cache, including resolving any wrapping key that is not cached either. Only a resolution that produced a crypter is recorded; a failed unwrap is not. Reading the key row is a storage statement and is part of db.client.operation.duration. |
| `zitadel.flow.step.transitions` | counter | `{transition}` | `operation`: `start`, `submit`, `render`; `result`: `step`, `complete`, `error` | Flow engine operations, by entry point and where they left the flow. Step names are defined per project and are deliberately not an attribute. |
| `zitadel.audit.insert.duration` | histogram | `s` | `source`: `request`, `event` | Duration of one audit insert: a single event in its transaction, or one attempt to write a batch of buffered request events (a retried batch is timed per attempt). |
| `zitadel.audit.events.written` | counter | `{event}` | `type`: fixed in code | Audit events handed to storage successfully, by event type. An event written inside a transaction that later rolls back is still counted. |
| `zitadel.cache.lookups` | counter | - | `cache`: fixed in code; `result`: `hit`, `miss` | Cache lookups, split into hits and misses. |
| `zitadel.cache.evictions` | counter | - | `cache`: fixed in code | Entries dropped from a cache because it was full. |
| `zitadel.cache.entries` | gauge | - | `cache`: fixed in code | Entries currently held in a cache. |

## Config file search paths

When `-c` is not passed, the server looks for `nextgen.yaml` in:

- `.`
- `./config`
- `/etc/nextgen`

## Encryption keys

The server wraps every project's key encryption key (KEK) with one or more master keys, configured under
`server.master_keys`:

```yaml
server:
  master_keys:
    # Each key is keyed by its ID; the ID identifies which key wrapped a value.
    master-key:
      use_for_encryption: true
      # RSA private key inline as PEM (incl. OpenSSH) or JWK ...
      private_key: |
        -----BEGIN PRIVATE KEY-----
        ...
        -----END PRIVATE KEY-----
      # ... or point at a file instead of inlining:
      # file: /etc/nextgen/keys/master-key.pem
```

Exactly one key must be marked `use_for_encryption: true`.

For local development, leave `server.master_keys` unset and persist
`server.data_dir`: the server generates an RSA master key at
`<server.data_dir>/master-keys/master-key.pem` and reuses it on subsequent starts.

For anything else, turn that generation off with `server.generate_master_key: false` (or
`--disable-master-key-generation`, which outranks the file and the environment). A start with no key then fails with an
error naming the directory it looked in, instead of minting a key. This matters most on ephemeral storage: without the
guard every instance and every revision mints its own key, and a project KEK wrapped by one of them cannot be unwrapped
by the next — a failure that surfaces later, as data that cannot be decrypted.

`server.master_keys` cannot be set from the environment: it is a map keyed by key id, and environment variables cannot
populate map keys. `NEXTGEN_SERVER_MASTER_KEYS_*` variables are ignored, and the server logs a warning naming them at
startup. Use the config file, or mount the key file into `<server.data_dir>/master-keys/`, where it is picked up by
file name.

To rotate the master key, add a new key marked `use_for_encryption: true` and keep the previous key (s) (as extra
entries or as files in the master key directory) for decryption; existing project KEKs are re-encrypted under the new
master key on the next start. For shared or production deployments, provide the key material through managed secrets
rather than committing it to source control.

Files in `<server.data_dir>/master-keys/` are merged into `server.master_keys` on every start, even when the setting is
configured explicitly. A file whose name matches a config entry's ID replaces that entry outright, dropping an inline
`private_key` and `use_for_encryption` — so keep the master key directory empty when you configure keys yourself, and
never name an entry after a file that could appear there.

For the full picture — the key envelope, key generation, the master-key-directory discovery rules, and the rotation
procedure — see [Encryption keys (master key / project KEK)](../operations/encryption-keys.md).
