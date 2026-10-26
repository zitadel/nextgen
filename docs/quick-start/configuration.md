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
| `server.public_base`     | `NEXTGEN_SERVER_PUBLIC_BASE`     | `https://nextgen.zitadel.cloud`                                     | Public origin browsers reach this deployment at; feeds the claim and dashboard URLs. Set to `http://localhost:8080` when running the server locally by hand; the CLI runtime (`zitadel start`) sets it itself. |
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

## Logging

| YAML key                                     | Environment                                          | Default                                       | Description                                    |
| -------------------------------------------- | ---------------------------------------------------- | --------------------------------------------- | ---------------------------------------------- |
| `instrumentation.log.level`                  | `NEXTGEN_INSTRUMENTATION_LOG_LEVEL`                  | `info`                                        | Minimum log level                              |
| `instrumentation.log.format`                 | `NEXTGEN_INSTRUMENTATION_LOG_FORMAT`                 | `text`                                        | Log output encoding                            |
| `instrumentation.log.streams`                | `NEXTGEN_INSTRUMENTATION_LOG_STREAMS`                | `[runtime, ready, request, service, storage]` | Which log streams are enabled                  |
| `instrumentation.log.errors.report_location` | `NEXTGEN_INSTRUMENTATION_LOG_ERRORS_REPORT_LOCATION` | `true`                                        | Record where each error was created            |
| `instrumentation.log.errors.stack_trace`     | `NEXTGEN_INSTRUMENTATION_LOG_ERRORS_STACK_TRACE`     | `true`                                        | Capture a stack trace when an error is created |

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
whenever it was captured. ADR 030 intends stack capture to be off in production, but the
server currently defaults it to on. The decision is tracked in
[#1485](https://github.com/zitadel/nextgen/issues/1485).

```yaml
instrumentation:
  log:
    level: debug
    format: json
    streams: [request, service]
    errors:
      report_location: true
      stack_trace: false
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
