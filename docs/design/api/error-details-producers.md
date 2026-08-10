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

Human-readable explanation that is not structured data belongs in `Message` (`WithMessage`), not `Details`.

## Wire shape

The API nests producer payloads under `details.details` (legacy shape). Use [`marshalErrorDetails`](../../../internal/api/error_handler.go) when composing the envelope. Test-only `FullErrorInResponse` may also attach `details.parent`; that path is not part of the public contract and must not be asserted by API integration tests.

## Reference producers

### Request field validation — `RequestInvalidFieldDetails`

Flow `Fields` value decode failures attach `{field}` only (no parser text, no payload fragments). See [`SubmitFlowStep`](../../../internal/api/flow.go) and [`flowFieldDecodeError`](../../../internal/api/flow.go).

## Inventory (fix / defer)

| Location | Shape | Status |
|----------|-------|--------|
| `flow.go` flow field decode | `RequestInvalidFieldDetails` | **Reference** |
| `session.go` `SessionInvalidTTLDetails` | typed `{ttl,max_ttl}` (ISO via `ogenx.ISODuration`) | **Deferred** — dedicated hand-built envelope in `sessionErrorResponse` (skips `domainErrorDetails` / `marshalErrorDetails`, so no test-only `details.parent`); fold into the shared path later |
| flowdef handlers | string validation messages | **Deferred** — already on wire in integration tests |
| `authz.go` write-miss handlers | opaque string on wrong codes | **Deferred** — intentional authz opacity |
| `domain/user.go`, `service/user.go` | was string `WithDetails` | **Fixed** — moved to `Message` |
| `service/auth_attempt.go` unsupported proof | was string `WithDetails` | **Fixed** — moved to `Message` |
| `service/list.go`, `service/project.go`, `service/team.go` filter/sort strings | string `WithDetails` | **Deferred** — inventory only this PR |
| crypto / token / signing / encryption `WithDetails` | strings or maps | **Deferred** — often internal; review before promoting to public details |
