# ADR 030: Error Model, Mapping, and Reporting

> **Status:** Proposed
> **Date:** 2026-06-26
> **Context:** Cross-cutting error taxonomy, API contract, logging, and operational reporting
> **Related:** [#367](https://github.com/zitadel/nextgen/issues/367), [#48](https://github.com/zitadel/nextgen/issues/48)

## Context

`nextgen` already implements partial error handling across layers:

| Layer | Location | Shape |
|---|---|---|
| Domain | `internal/domain/error.go` | `domain.Error` with `Code`, `Message`, `Details`, `Parent`, `Location` |
| Storage | `internal/storage/v2/database/error.go` | Typed `database.*Error` values (`NoRowFoundError`, `UniqueError`, …) |
| Dialect | `internal/storage/v2/dialect/*/error.go` | Driver → `database.*Error` normalization |
| Service | `internal/service/*` | Ad-hoc `errors.AsType` mapping from storage to domain |
| API | `internal/api/error_handler.go` | Prefix/code routing → HTTP status + `ErrorDetails` |
| Instrumentation | `internal/instrumentation/config.go`, `zlog/` | GCP log formatting, optional masking, `ErrorConfig` knobs |

There is no single decision that defines:

- the canonical internal error type and code taxonomy,
- when and where location/stack traces are captured,
- what may appear in API `details` vs logs vs GCP Error Reporting,
- how storage errors become domain errors and how domain errors become HTTP responses,
- which codes are stable public contract vs internal-only.

Without this, implementations drift: flow handlers construct inline `domain.Error` literals, session codes mix prefix styles, OpenAPI documents a `details` field the API does not populate, and `instrumentation.log.errors.{report_location,stack_trace}` exist but are not wired.

## Inventory: Current Usage and Gaps

### Domain (`domain.Error`)

- **Adopted pattern:** resource-scoped sentinel factories (`ErrUserNotFound`, `ErrAuthAttemptInvalidProof`, …) built through `newError`, which records `Location` via `runtime.Caller`.
- **Code naming:** most resources use `ResourcePrefix.ErrorCodePrefix("…")` (`user.not_found`, `att.not_found`). Session codes use a manual `sess.` prefix. Flow runtime errors in `internal/api/flow.go` use ad-hoc string literals (`flow_cookie_invalid`, `invalid_action`, …) without sentinel factories.
- **`errors.Is` support:** `Code` is the primary match key; `WithMessage` / `WithDetails` / `WithParent` preserve `Code`.
- **`Details`:** when callers pass `nil` details, `newError` copies `Parent` into `Details`. This is useful for logging but must not leak to clients.
- **Gap:** no documented rules for what belongs in `Details`, and no redaction helper at the domain boundary.
- **Gap:** `newError` records no structured location/stack and has no parent-aware capture; `Location` is a basename `file:line` string, not the structured `sloggcp.ReportLocation` the GCP handler consumes (Decision 5 changes this).

### Storage (`database.*Error`)

- **Adopted pattern:** dialect `wrapError` maps PostgreSQL `PgError` codes and Spanner gRPC codes into a small set of storage sentinels (see [#48](https://github.com/zitadel/nextgen/issues/48)).
- **Strength:** integrity violations carry `table` and `constraint`; errors unwrap to the driver cause.
- **Gap:** storage errors are not consumed uniformly. Some services map `NoRowFoundError` / `UniqueError` explicitly (`internal/service/user.go`); others bubble `ErrInternal`. There is no shared `MapStorageError` helper or table keyed by resource + constraint.
- **Gap:** `PermissionError` and `UnknownError` have no standard domain mapping.
- **Gap:** storage errors capture no location or stack, so traces can never reach the storage/driver origin (Decision 5 changes this).

### Service

- **Pattern:** translate storage semantics at the use site, return `domain.Error` (or domain validation errors) to API.
- **Gap:** translation logic is duplicated and inconsistent across services.
- **Gap:** operational context (request id, resource ids) is not attached in a structured way before logging.

### API

- **Wire format:** OpenAPI `ErrorDetails` requires `code` and `message`; `details` is optional (`api/openapi/components/error-details.yaml`).
- **Implementation:** `domainErrorDetails` emits only `code` and `message`. `details` is never populated today.
- **HTTP mapping:** per-resource `*ErrorResponse` functions switch on `err.Code` (users, sessions, auth attempts, flow definitions, teams, schemas). Unknown codes under a known prefix fall through to `internal` (500).
- **Central routing:** `Handler.NewError` and `OgenErrorHandler` delegate to `errorResponse`, which routes by code prefix.
- **Gap:** flow runtime codes are not in OpenAPI error schemas and are assembled inline in `mapFlowErrorStatus`.
- **Gap:** decode/validation errors replace the public message with the raw ogen error string (`err.Error()`), which can be more specific than other endpoints.

### Logging and reporting

- **Handlers:** `LogFormatGCPErrorReporting` uses `sloggcp.NewErrorReportingHandler`; `ReplaceErrKeys` renames the `err` attribute key to `sloggcp.ErrorKey` (`"error"`).
- **Context:** `ExtractErrCause` logs `context.Cause(ctx)` when present.
- **Masking:** `MaskConfig` redacts configured attribute keys/groups in log output.
- **Config:** `ErrorConfig.ReportLocation` and `ErrorConfig.StackTrace` exist but are **not read anywhere** yet.
- **Request logging:** `middleware.WithLogging` (wired in `cmd/server/server.go`) logs every request on entry (`method`, `url`, `uri`) and on exit. Responses with status ≥ 400 are logged at **`Error`** with the **full serialized response body** and `operation_id`; otherwise at `Info`.
- **Gap:** `domain.Error.Location` is not attached to structured log records.
- **Gap:** the generic request-logging path above is separate from per-error structured logging (Decision 5), logs **all** 4xx at `Error`, and logs the raw response body — so any API leak (Decision 6) also reaches logs, and there is no `Error`-vs-`Warn` policy for expected client errors.

## Decision

### 1. Canonical internal error model

**Adopt `domain.Error` as the canonical error returned from domain and service layers to the API**, with three refinements over the current type.

Rationale:

- It already supports stable `Code`, user-facing `Message`, structured `Details`, and wrapped `Parent`.
- API translation and `errors.Is` matching are built around it.
- Introducing a parallel type would duplicate the sentinel factories and OpenAPI mapping.

Refinements (behavioral, not a new type):

- **Implement `Unwrap() error`** returning `Parent`, so standard `errors.Is` / `errors.As` traverse into the cause chain (for example reach a `database.NoRowFoundError` wrapped by `ErrInternal`). The existing code-based `Is` stays for sentinel matching.
- **`Error()` returns only `Message`** (no parent chain), so the Go-default `err.Error()` render is safe by construction; the cause is reached via `Unwrap()` and structured logging instead (see Decision 4 → Messages and Decision 5).
- **Stop copying `Parent` into `Details`.** `newError` no longer falls back to `details = parent`; `Details` is only what a caller explicitly attaches via `WithDetails`. This removes the leak path the redaction policy (Decision 6) would otherwise have to defend against.
  - *Provenance:* the `details = parent` fallback was introduced in [#207](https://github.com/zitadel/nextgen/pull/207) (branch `fix/token-handling`) with an empty PR description, no review discussion on `error.go`, and no code or test in that PR consuming it. Its effect is to populate the in-memory `Details` field with the wrapped cause (often a raw storage/driver error). It does **not** reach clients today — `domainErrorDetails` serializes only `code` and `message` (see Inventory → API), so `details` is never emitted — but it is a **latent** leak: the cause surfaces to anything that logs `Details` or serializes a `domain.Error` directly, and it would reach clients the moment `details` population is enabled (Decision 4). In short, it is a debugging convenience that doubles as the leak risk above. Dropping it appears safe (current `Details` consumers in `session.go`, `flow.go`, and `session_ttl_test.go` all set details explicitly); confirm with a grep at implementation time since the behavior has been live since 2026-06-18.
- **Replace the `Location string` field with embedded capture** (see Decision 5): `domain.Error` embeds a shared `errreport.Origin` carrying a structured `*sloggcp.ReportLocation` and an optional stack, instead of a basename `file:line` string.

`domain.Error` stays a **value type**. The refinements above (value-receiver `Unwrap`, embedded `Origin`, `slog.LogValuer`) do not require a pointer type, so the existing sentinel-factory and value-return patterns are unchanged.

**Keep `database.*Error` as the storage-layer model.** Storage errors stop at the service/repository boundary and are translated into `domain.Error` before crossing into API handlers. They are not returned directly to HTTP clients.

Layer contract:

```
driver/dialect → database.*Error → domain.Error → api.ErrorDetails (+ HTTP status)
                                      ↓
                               structured logs / GCP Error Reporting
```

The downward branch is the **diagnostic channel**, not a fourth runtime layer:

- **Horizontal (→):** error *transformation* — each step narrows and re-labels the failure for the next consumer.
- **Vertical (↓):** error *observability* — what structured logs and GCP Error Reporting consume once something logs the error.

`domain.Error` is the last type that still carries causes (`Parent`), capture metadata (`Origin`: location, stack), and a log-safe shape (`slog.LogValuer`). `api.ErrorDetails` is the client-safe subset (`code`, `message`, optional `details`); it deliberately omits `Parent` and reporting metadata.

**`internal/domain` does not call `slog`.** Layers construct errors; the API/instrumentation boundary emits logs (today: `middleware.WithLogging`; see Inventory → Logging and Decision 5 → Expected client errors). Typical flow:

1. Storage/service/domain **return** a `domain.Error` (or an error wrapped as one).
2. API **maps** it to `api.ErrorDetails` + HTTP status for the response.
3. Request middleware (or explicit `slog.Any(ErrorAttributeKey, err)` at the boundary) **logs** the `domain.Error` via `LogValue` / GCP interfaces — not the serialized response body.

Optional call-site logs in the **service** layer may add deliberate, safe context (for example `attribute_key=email` in Decision 6); that is the exception, not the default path.

#### Error package layering

Error *types* stay per-layer; only the capture *mechanism* is shared.

- **`internal/errreport` (leaf):** owns the global reporting toggles and the `Capture(parent, skip) Origin` primitive (Decision 5). Depends only on `sloggcp` and the runtime; knows nothing about `domain` or `storage`.
- **`database.*Error`:** keeps its typed taxonomy (`UniqueError{table, constraint}`, `NoRowFoundError`, …) and embeds `errreport.Origin`. Never crosses to the API.
- **`domain.Error`:** remains the **only** type the API serializes; embeds `errreport.Origin`.

Rationale for distinct types rather than one universal error type (`zerrors`-style):

1. **API invariant.** "Only domain errors surface in the API" is structural when the API mapper only knows `domain.Error`; a universal type would require enforcing it by convention.
2. **Storage taxonomy.** The service maps on storage specifics (`errors.AsType[*database.UniqueError]`, constraint names — `internal/service/user.go`). Flattening to one type loses the typed mapping built for [#48](https://github.com/zitadel/nextgen/issues/48).
3. **Layering.** A single code-bearing type would force `storage` to depend on API-facing error codes.

Cross-type behavior (deepest-first location and stack inheritance) works through the shared `sloggcp.StackTraceError` / `sloggcp.ReportLocationError` interfaces — implemented by the embedded `Origin` — not through a shared concrete type.

### 2. Error code taxonomy

#### Format

- **Resource errors:** `{prefix}.{condition}` where `prefix` matches `ResourcePrefix` (`user`, `att`, `flowdef`, `sch`, `team`, `pkreg`, …).
- **Cross-cutting errors:**
  - `req.invalid` — structural request validation before domain logic
  - `auth.unauthorized` — missing/invalid credentials at the domain/security boundary
  - `internal` — unexpected failure; always maps to HTTP 500 with a generic message
  - `not_implemented` — deliberate stub; HTTP 501
- **Flow runtime errors:** use a `flow.` prefix and gain sentinel factories in `internal/domain` (for example `flow.cookie_invalid`, `flow.completed`). Inline literals in `internal/api/flow.go` are technical debt to migrate.

#### Stability classes

| Class | Meaning | OpenAPI | Client handling |
|---|---|---|---|
| **Public stable** | Documented in OpenAPI error schemas; safe for clients to branch on | Required schema per code | Supported |
| **Public opaque** | Returned to clients but treated as generic failure | `internal` only | Do not branch |
| **Internal-only** | `Origin` (report location, stack), `Parent`, driver messages, SQL | Never exposed | N/A |

New public codes require an OpenAPI error schema under `api/openapi/components/schemas/errors/` and an entry in the resource `*ErrorResponse` mapper.

#### Sentinel factories

- Declare errors as package-level sentinel factories (`func ErrUserNotFound() Error`), not string literals at call sites.
- Use `WithMessage`, `WithDetails`, and `WithParent` to add context without changing `Code`.
- Prefer `errors.Is(err, domain.ErrUserNotFound())` in tests and handlers.

### 3. Storage → domain mapping

Translation happens in the **service layer** (or a dedicated mapper next to the repository for that aggregate), not in dialect code and not in API handlers.

Baseline mapping:

| Storage error | Typical domain mapping | Notes |
|---|---|---|
| `NoRowFoundError` | Resource `*.not_found` | Map per operation (user, session, schema, …) |
| `UniqueError` | Resource `*.already_exists` | Use constraint name when multiple unique indexes exist |
| `CheckError`, `NotNullError`, `ForeignKeyError` | `*.invalid` or `ErrInternal` | Prefer `*.invalid` when the client can fix the request |
| `MultipleRowsFoundError`, `ScanError` | `ErrInternal` | Data invariant broken; always operational |
| `PermissionError` | `auth.unauthorized` or `ErrInternal` | Depends on whether the caller is an end user vs operator |
| `UnknownError` | `ErrInternal(parent)` | Preserve parent for logs only |

**Do not** map storage errors to domain inside `internal/storage/v2/dialect`. Dialect stays driver-aware; domain stays business-aware.

Follow-up tracked by [#48](https://github.com/zitadel/nextgen/issues/48): introduce a small shared helper (for example `storagemap.NotFound(err) bool`) only to reduce duplicated `errors.AsType` boilerplate, not to hide resource-specific semantics.

### 4. Domain → API mapping

Every error response is the ogen-generated `api.ErrorDetails` (`api/openapi/components/error-details.yaml`): a required `code` (stable machine key) and `message` (human-facing string), plus an optional `details`. These wire types are generated from `api/openapi` by ogen (`api/generate.go`; see `api/openapi/readme.md`) — change the OpenAPI source, never `api/generated`.

#### Response body

- Always return `code` and `message` from the `domain.Error`.
- **`Details` is marshalled to the client whenever a producer sets it** (standard JSON marshalling). Setting `Details` *is* the act of exposing it — there is no separate per-code allow-list.
- `Details` must contain only **client-actionable, non-sensitive** data (field paths, schema validation issues, conflict keys). Keeping secrets/PII out is the **producer's** responsibility (Decision 6), because the value is client-facing by intent.
- A details **container type is not a client-redaction mechanism**: a `map`/struct marshals whatever it holds, and no generic type can distinguish intended PII (for example the subject's own email on a self-scoped endpoint) from a leak. Redaction is enforced by producer discipline and review, not by the type.
- Producer contract, reference patterns, and inventory live in [`docs/design/api/error-details-producers.md`](../design/api/error-details-producers.md) ([#585](https://github.com/zitadel/nextgen/issues/585) task B).

#### HTTP status

- Status mapping stays in `internal/api/*_errorResponse` functions, keyed by `err.Code`.
- Prefix-based routing in `errorResponse` chooses the mapper; unknown codes under a prefix become `internal` (500).
- `internal` responses use the generic domain message regardless of `Parent` content.
- **HTTP semantics stay in the API layer.** Do not add an `ErrorClass` (or similar) to `domain.Error` — specific codes exist precisely so the same logical failure (for example not-found during auth) need not always map to 404. Follow-up: deduplicate the repetitive per-resource `switch`es via a shared helper, suffix conventions for the common cases, or a central `code → status` table/manifest in `internal/api` only (with explicit overrides for auth/opaque cases).

#### Messages

- `Message` is the customer-facing string. It must not contain stack traces, SQL, secret values, or raw driver text.
- For `req.invalid` and ogen decode errors, prefer normalized messages; avoid leaking parser internals when a stable domain message exists.
- **`domain.Error.Error()` returns only `Message`; it does not include the parent chain.** `err.Error()` is the Go-default way to render an error, so the default must be safe. The parent is only needed for diagnostics, which are served by `Unwrap()` (programmatic traversal / `errors.Is` / `errors.As`) and `LogValue` (structured logs explicitly emit `parent`, Decision 5). Making `Error()` parent-free means the common `err.Error()` call cannot leak a wrapped cause.
- This does **not** make every `Error()` safe: non-`domain.Error` values (storage `database.*Error`, ogen framework errors) can still include their cause in `Error()`. API code must therefore avoid rendering a **non-domain** error's `Error()` into a client message — translate to a `domain.Error` first, or use the explicit `Message` field via `domainErrorDetails`.
- **Structured logging is required for error diagnostics.** Plain `%v` / unstructured logging of a `domain.Error` shows only `Message`; the cause is available via `Unwrap()` and via `slog.Any(ErrorAttributeKey, err)` → `LogValue` (Decision 5). There is no verbose `Error()` mode — that would reintroduce the parent-chain leak path this ADR removes. `internal/` uses `slog` exclusively; non-structured error logging is not a supported production path. Confirm at implementation time that no test asserts a chained string via `EqualError` / `ErrorContains` on a `domain.Error`.

### 5. Location, stack traces, and operational reporting

Capture is centralized in `internal/errreport` and configured by **global atomics** set once at startup. Errors are constructed deep in domain/service/storage with no config handle, so the toggles are package-level globals (`EnableLocation`, `EnableStack`, `GCPReporting`) seeded from `instrumentation.log.errors.*` and the active log format — matching the approach in `zitadel/zerrors`. This process-global trade-off is accepted deliberately (see Consequences).

#### `errreport.Origin` and the capture primitive

- Every structured error type embeds `errreport.Origin`, which carries a `*sloggcp.ReportLocation` and an optional stack, and implements `sloggcp.ReportLocationError` + `sloggcp.StackTraceError`.
- `errreport.Capture(parent error, skip int) Origin`:
  - for **location**, **inherits the deepest existing one**: if the `parent` chain already contains a `sloggcp.ReportLocationError`, reuse its location; otherwise record a fresh location at the creation site when location reporting is enabled;
  - for the **stack**, same deepest-first rule: if the `parent` chain already contains a `sloggcp.StackTraceError`, reuse its stack; otherwise capture a fresh stack when stack reporting is enabled.

#### Location

- Captured at **every** error-construction boundary, storage included — `database.*Error` records its origin in `wrapError`, `domain.Error` records its origin in `newError`.
- **Location follows deepest-first inheritance**, same as stack traces (above). Only one report location is sent to the logger, so the value is the **deepest point in the cause chain** — typically where a driver or third-party package first returned an error — not the site of the last domain wrap. Because location is **log-only** and never serialized to API responses, inheriting the origin does not leak information.
- Location is cheap (single `runtime.Caller`) and may be enabled by default; stack capture remains gated (expensive).

#### Stack traces

- Stack capture is **gated** (expensive `debug.Stack()`); intended for `internal`/unexpected errors and debug/non-production use, off by default in production.
- Stacks follow **deepest-first** semantics. Because the storage layer captures at `wrapError` — a frame that has already returned by the time the service translates the error — the storage error holds the deepest reachable stack, and the wrapping `domain.Error` inherits it via `errreport.Capture`. This is why storage must participate: the domain layer physically cannot recover frames that already unwound.
- `sloggcp` extracts the **outermost** `StackTraceError` and `ReportLocationError`; deepest-first inheritance guarantees that outermost error already carries the deepest values, so no chain-walking is needed at log time.

#### Structured logging

- `domain.Error` implements `slog.LogValuer`. It emits `code`, `message`, and `parent`; when GCP error reporting is active it **omits** location/stack from the log value (the GCP handler adds them from the `ReportLocationError` / `StackTraceError` interfaces) to avoid duplication. Emission stays at the request boundary (Decision 1 → Layer contract); `LogValuer` defines the shape consumed when that boundary logs the error.
- Outside GCP mode, when logging a `domain.Error` at `Error` level or above, the value additionally includes `reportLocation` and (if present) `stackTrace`.

#### GCP Error Reporting

- Production JSON logging may use `LogFormatGCPErrorReporting`; the format wires `errreport.GCPReporting(true)`, replacing the commented-out `zerrors.GCPErrorReportingEnabled(true)` stub in `internal/instrumentation/config.go`.
- Log the root error with `slog.Any(ErrorAttributeKey, err)`; the handler resolves location/stack through the shared interfaces and `Parent` via `Unwrap()`.
- `context.Cause` continues to surface through `ExtractErrCause`.
- With `sloggcp` as the log handler, log lines that match the Error Reporting format are **collected automatically** by GCP (parsed from structured output — there is no separate "send to Error Reporting" step). Expected client errors logged at `Info` or `Warn` may therefore appear in Error Reporting; that is acceptable for spotting client-facing hotspots (for example a sudden spike of 403s). **Alerting policy** based on severity or error class is out of scope for this ADR.

#### Expected client errors (4xx)

- Log at `Info` or `Warn` with `error.code` and request correlation attributes.
- `middleware.WithLogging` (Inventory) currently logs **all** status ≥ 400 at `Error` with the full response body. Align it: log expected 4xx at `Info`/`Warn`, reserve `Error` for `internal`/5xx, and stop logging the raw response body — log the structured `code` plus safe attributes instead (Decision 6).
- Expected storage signals (for example `NoRowFoundError` → `*.not_found`) should not trigger stack capture in normal operation; capturing stacks for frequently-expected errors is acceptable only while the debug toggle is on.

### 6. Redaction and PII policy

#### API

Never expose in `code`, `message`, or `details`:

- passwords, OTPs, session tokens, handoff tokens, API keys, private keys,
- raw SQL, driver errors, table/column names from storage errors,
- email/phone or other identifiers unless the endpoint is explicitly self-scoped (for example `/users/me`) and the field is the subject of the error.

`Parent` and driver causes are for logs only.

#### `domain.Error.Details`

Allowed examples:

- JSON Schema validation paths,
- unknown `$schema` URL (no user attributes),
- field-level constraint names safe for clients.

Forbidden: credential material, full storage error strings, rows/records containing PII.

#### Logging

- **`Details` is not logged by default.** `domain.Error`'s `LogValue` (Decision 5) emits `code`, `message`, and `parent` but not `Details`, because `Details` is the client face — its contents are governed by producer discipline, not log-safety. A specific details type may opt into logging by implementing `slog.LogValuer` (emitting only named, non-sensitive attributes); otherwise it stays out of logs.
- **Wrapped causes must be log-safe at the source.** A `Parent` is logged by default (it is the diagnostic payload), but key-masking cannot reach inside a free-form `Error()` string. Error types that may wrap value-bearing driver errors — notably `database.*Error` — must implement `slog.LogValuer` emitting typed fields (`integrity_type`, `table`, `constraint`) and must **not** surface the raw driver cause (for example `pgconn.PgError.Detail`, which embeds the offending row — for the unique-attribute schema that is the `value_hash`, a salt-less SHA-256 that stays sensitive because it is reversible for low-entropy identifiers). The offending value never enters a log through an error; if a discriminator is needed it is logged deliberately at the call site (see worked example).
- Apply `instrumentation.log.mask.keys` to attribute names such as `password`, `token`, `secret`, `authorization`, `cookie`, `session`, and nested groups that carry credentials.
- When logging `ErrInternal`, log the unwrapped `Parent` chain server-side; mask attribute keys that appear in structured args.

#### Worked example: debugging a unique-attribute conflict

Scenario: a user cannot register because a unique attribute (for example their email) is already taken. The data model matters here. User attributes are stored EAV in `zitadel_nextgen.user_attributes`; uniqueness is enforced indirectly by hashing the value with SHA-256 and writing it to `zitadel_nextgen.user_unique_attributes`, whose primary key `(project_id, team_id, key, value_hash)` is the unique constraint. A duplicate raises a `23505` on that table's partition. The two facts involved have different owners:

1. **Which rule failed** is the error's job — but only partially. The pg dialect captures `table` + `constraint`, here `user_unique_attributes` and a partition PK such as `user_unique_attributes_part_0_pkey`. The storage error's `LogValue` emits those typed fields and drops the driver `Detail`. Two reasons the `Detail` must be dropped: the row it names contains the `value_hash` (a salt-less SHA-256 of, for example, an email — reversible for low-entropy identifiers, so still sensitive), and the PK constraint name is shared by *all* unique attributes, so it does not even reveal which attribute collided.

The **`level=WARN` line below is emitted by the registration service** when it maps the storage `UniqueError` to a domain error (for example `domain.ErrEmailTaken().WithParent(err)`) — a **client error** (409), not an application failure. The storage error is the `parent` on that log line. Optional `Debug` logs inside `internal/storage` are package-scoped instrumentation only; they are not the primary error-reporting path for request handling.

```
level=WARN msg="registration failed" code=user.email_taken
  parent.db_error=integrity_violation parent.integrity_type=unique
  parent.table=user_unique_attributes parent.constraint=user_unique_attributes_part_0_pkey
  request_id=... trace_id=... org_id=...
```

2. **Which attribute collided** is the caller's knowledge, not the error's. The discriminating signal is the attribute `key` (`email`), and the registration service already has it because writing that attribute is the operation it is performing. It logs that deliberately, as a **named, non-sensitive** attribute — the field name, never the value or its hash:

```go
logger.LogAttrs(ctx, slog.LevelDebug, "unique attribute conflict",
	slog.String("attribute_key", "email"), // the field name, not the value
)
```

This keeps both the value and its hash out of logs without losing debuggability: the structured cause says a uniqueness rule fired on `user_unique_attributes`, the caller adds the safe discriminator (`attribute_key=email`), and correlation identifiers (`request_id` / `trace_id`) let an operator pivot from the log line back to the originating request — including a captured HAR or trace that already carries the entered value — under the access controls that protect request data, rather than baking the value or its hash into every error log permanently.

#### Masking limits for schema-driven data

`MaskConfig` (Inventory → Logging) is a **static deny-list of attribute key names** (`password`, `token`, …) applied per slog attribute. It is a backstop, not the mechanism for user/schema-driven data, for two structural reasons:

- **Keys are open-ended.** User attributes are EAV, defined per tenant by JSON Schemas (`api/openapi/endpoints/schemas`). The sensitive key set (`ssn`, `date_of_birth`, custom fields) cannot be enumerated in a global list ahead of time.
- **Values land in opaque blobs.** Key masking matches attribute *keys*; it cannot reach inside a serialized JSON body. The request-logging middleware logging the full `response` body string is exactly this case.

Policy:

1. **Default-sensitive: do not log user/schema attribute payloads or raw request/response bodies.** Log the structured domain error (`code` + safe `message` + a few named, safe attributes), never the serialized body. This removes the blob problem at the source.
2. **Declare sensitivity in the schema, enforce at the boundary.** Sensitivity is a property of the JSON Schema (`writeOnly`, `format: password`, or an `x-zitadel-sensitive` extension), consulted by the attribute-handling code — not guessed by the generic slog layer.
3. **Keep static key masking as defense-in-depth** for fixed-name credential attributes that appear in structured args.
4. **URLs are safe-to-log by construction, not by redaction.** Path and query params are already logged everywhere downstream (proxies, load balancers, access logs, browser history, `Referer`), so the rule is the inverse of redaction: **no secret or PII may be carried in a path or query parameter** — those belong in headers or the request body. Logging keeps the URL and omits only the body.

#### Known current leaks to remediate

The canonical mapper (`domainErrorDetails` → only `Code` + `Message`) is clean. With `Error()` trimmed (Decision 4 → Messages), `domain.Error` chains rendered via `Error()` become safe too. These remaining side paths still need call-site fixes because they render **non-domain** errors or rely on raw text:

- `internal/api/project.go`, `Handler.GetProject` — concatenates a `*database.NoRowFoundError` into the `GetProjectNotFound` message: `"project not found: " + notFound.Error()`. A storage error's `Error()` still carries the driver cause. **Hard leak — must fix.**
- `internal/api/error_handler.go`, `OgenErrorHandler` — sets `d.Message = err.Error()` for ogen security and decode errors (raw framework text). **Must fix / normalize.**
- `internal/api/flow.go`, `Handler.SubmitFlowStep` — `domain.ErrRequestInvalid().WithMessage(err.Error())` surfaces raw decode/parse error text (non-domain `err`) in the field-decode and origin-validation branches. **Must fix / normalize.**
- `internal/api/flow.go`, `mapFlowErrorStatus` — `Message: err.Error()` for `invalid_action` / `session_conflict` / `unsupported`. Mitigated by the trimmed `Error()` when `err` is a `domain.Error`, but still migrate to `flow.*` sentinels with fixed messages (Decision 2) rather than relying on `Error()`.
- `internal/storage/v2/database/integrity_errors.go` — `IntegrityViolationError.Error()` (and `NoRowFoundError` / `ScanError` / `UnknownError`) render the wrapped `original` driver error with `%v`. For a `23505` the pg dialect stores `*pgconn.PgError` as `original` (the `23505` case in `wrapPgError`), whose `Detail` embeds the offending row — for the unique-attribute schema, `Key (project_id, team_id, key, value_hash)=(…, …, email, \x9f86d0…) already exists.`, exposing the sensitive `value_hash`. This is **log-safe-at-source** work: add a `LogValue` that emits typed fields only and stops carrying the driver `Detail` into logged output. **Log leak — must fix.**

### 7. Backwards compatibility and migration

1. **New work:** use sentinel factories and documented codes only; add OpenAPI schemas before declaring a code public.
2. **Flow runtime errors:** migrate `internal/api/flow.go` inline codes to `internal/domain/flow_errors.go` with `flow.*` sentinels and OpenAPI entries.
3. **Session codes:** keep existing `sess.*` strings stable; new session errors should use `ResourcePrefix` if `PrefixSession` is introduced.
4. **API `details`:** enable per-code in a follow-up change after redaction review; OpenAPI already allows the field.
5. **Instrumentation:** add the `internal/errreport` leaf and wire its global toggles (`EnableLocation`, `EnableStack`, `GCPReporting`) from `log.errors.*` / format in a follow-up; this ADR defines the intended behavior.
6. **Storage mapping helper ([#48](https://github.com/zitadel/nextgen/issues/48)):** optional shared detection helpers; resource-specific mapping stays in services.

## Consequences

### Positive

- One internal error shape from domain through API translation.
- Clear boundary between storage, business, and wire errors.
- Explicit rules for logs vs client payloads vs Error Reporting.
- Stable public codes align with existing OpenAPI error schemas.

### Negative / trade-offs

- Service-layer mapping remains explicit (intentionally — constraint-to-semantics is resource-specific).
- `domain.Error` stays a value type; `Unwrap`, embedded `errreport.Origin`, and `slog.LogValuer` do not require a pointer, so existing value-return patterns are unchanged.
- `domain.Error.Error()` returns only the public `Message`; diagnostics live in `Unwrap()` / structured `LogValue` logging (Decision 4 → Messages). Storage and framework errors still carry their cause in `Error()`, so non-domain `Error()` rendering still needs call-site discipline (Decision 6).
- Reporting toggles are **process-global atomics** in `errreport` (matching `zerrors`), not per-request config. This is the accepted trade-off for constructing errors deep in the stack without a config handle.
- Storage participates in capture (`wrapError` records an `Origin`). Location is cheap; gated stack capture may run for frequently-expected errors (for example `NoRowFoundError`) while the debug toggle is on.
- A new `internal/errreport` leaf package and embedding `Origin` across `domain` and `storage` error types is upfront churn.
- Enabling API `details` and instrumentation wiring are follow-up implementation tasks, not automatic with this ADR.

## Follow-up work

| Item | Owner surface | Tracking |
|---|---|---|
| `internal/errreport` leaf (global toggles + `Capture`/`Origin`) | Instrumentation / shared | #367 |
| `domain.Error`: add `Unwrap`, trim `Error()` to `Message`, drop `Parent`→`Details` fallback, embed `Origin`, `LogValuer` | Domain | #367 |
| Remediate API leak sites (`Handler.GetProject`, `OgenErrorHandler`, `Handler.SubmitFlowStep`, `mapFlowErrorStatus`) | API | #367 |
| `database.*Error`: embed `Origin`, capture in `wrapError`, add log-safe `LogValue` (typed fields; drop driver `Detail`/value) | Storage | #48 / #367 |
| Wire `errreport` toggles + `GCPReporting` from `log.errors.*` / format | Instrumentation | #367 |
| Flow error sentinels + OpenAPI schemas | API / domain | #367 |
| Shared storage error detection helpers | Storage / service | #48 |
| Selective API `details` population | API | [#585](https://github.com/zitadel/nextgen/issues/585) (was #367) |
| Align `WithLogging`: 4xx at `Info`/`Warn`, stop logging raw response bodies | API / instrumentation | #367 |
| Deduplicate API `code → HTTP status` mapping (helper / manifest in `internal/api`; no `ErrorClass` on domain) | API | #367 |
| Schema-declared attribute sensitivity; audit no secret/PII in path/query params | API / domain | #367 |

## References

- `internal/domain/error.go` — canonical domain error type
- `internal/storage/v2/database/integrity_errors.go` — storage error taxonomy
- `internal/api/error_handler.go` — API mapping and `OgenErrorHandler`
- `internal/instrumentation/config.go` — log format, masking, error reporting config
- `api/openapi/components/error-details.yaml` — public wire shape
- `github.com/zitadel/sloggcp` — `ReportLocationError`, `StackTraceError`, `NewReportLocation` consumed by the GCP handler
- `github.com/zitadel/zitadel` `internal/zerrors` — reference implementation of gated capture, parent inheritance, and `LogValuer`
