# API error `details` producers

> **Status:** Active
> **Related:** [ADR 030](../../adrs/030-error-model-mapping-and-reporting.md), [#585](https://github.com/zitadel/nextgen/issues/585)

## Contract

`domain.Error.Details` is client-facing. Setting `Details` **is** exposing it — there is no per-code allow-list. Producers must attach only **client-actionable, non-sensitive** data (ADR 030 Decision 4 + 6).

### Allowed

- Field paths and constraint names
- Schema / validation issue summaries without user attribute values
- Conflict keys safe for the caller (for example purpose names on flow-definition updates)

### Forbidden

- Passwords, OTPs, tokens, API keys, private keys
- Raw SQL, driver errors, storage row payloads
- Email, phone, or other identifiers unless the endpoint is explicitly self-scoped and the field is the subject of the error

`Parent` and `Origin` stay log-only; `domain.Error.LogValue` omits `Details` by default.

## Wire shape

The API nests producer payloads under `details.details` (legacy shape). Use [`marshalErrorDetails`](../../../internal/api/error_handler.go) for generic encoding; typed detail structs carry their own JSON rules (for example [`isoduration.Duration`](../../../internal/isoduration/duration.go) for ISO-8601 durations).

## Reference producers

### Session TTL — `SessionInvalidTTLDetails`

[`internal/domain/session.go`](../../../internal/domain/session.go) attaches `{ttl,max_ttl}` as [`isoduration.Duration`](../../../internal/isoduration/duration.go) values. Generic `json.Marshal` emits ISO-8601 strings on the wire (same format as exchange request `ttl`).

### Request field validation — `RequestInvalidFieldDetails`

Flow `Fields` value decode failures attach `{field}` only (no parser text, no payload fragments). See [`SubmitFlowStep`](../../../internal/api/flow.go) and [`flowFieldDecodeError`](../../../internal/api/flow.go).

## Inventory (fix / defer)

| Location | Shape | Status |
|----------|-------|--------|
| `session.go` `SessionInvalidTTLDetails` | typed struct | Reference |
| `flow.go` flow field decode | `RequestInvalidFieldDetails` | Reference |
| `flow_definition_errors.go` / flowdef handlers | string validation messages | Kept — already on wire in integration tests |
| `authz.go` write-miss handlers | opaque string on wrong codes | **Deferred** — intentional authz opacity |
| `domain/user.go`, `service/user.go` | was string `WithDetails` | **Fixed** — moved to `Message` |
| `service/auth_attempt.go` unsupported proof | was string `WithDetails` | **Fixed** — moved to `Message` |
