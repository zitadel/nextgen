# API Conventions

> The stuff every endpoint shares — IDs, errors, pagination, list queries,
> idempotency. The OpenAPI 3.1 sources under
> [`api/openapi/`](../../../api/openapi/readme.md) are the contract of record;
> this doc summarizes the shipped conventions and marks what is still
> direction. For vocabulary, [`../glossary.md`](../glossary.md).

## Shape (shipped)

| Area | Convention |
|---|---|
| **IDs** | Prefixed, opaque, dialect-minted (`prefix_<opaque>`). Prefix is part of the ID (e.g. `user_01H…`, `proj_01H…`). No scope hints encoded — the resource-scope index resolves them. Project IDs are `proj_*` ([ADR 047](../../adrs/047-dialect-id-generation.md)); the older dictionary-slug form is retired. |
| **Verbs** | `POST`, `GET`, `PUT`, `PATCH`, `DELETE`. `PUT` is reserved for full-document replacement (`PUT /flow_definitions/{id}`, `PUT /users/{id}/password`); partial updates use `PATCH`. |
| **Wire casing** | `snake_case` for fields, enum values, and parameters — enforced by the redocly rules and the `workspace:check-openapi-rules` gate. Wrong casing fails silently at runtime (unknown properties are dropped), which is why the gate exists. |
| **Timestamps** | RFC3339 UTC strings. Never epoch millis. |
| **Response shape** | Single resources are plain objects. Cursor-paginated lists are `{ <resource>: […], next_page_token }` (e.g. `{ sessions: […], next_page_token }`) — there is no `object`/`data` envelope. Two shipped exceptions predate the pattern and are normalization candidates: `GET /branding` returns a bare array, and `GET /schemas` is still offset/limit. |
| **Errors** | `{ code, message, details? }` per [`error-details.yaml`](../../../api/openapi/components/error-details.yaml). `code` is stable, machine-readable, and dot-namespaced (e.g. `att.invalid_proof`); the per-endpoint catalog under `api/openapi/components/schemas/errors/` is generated — clients branch on `code`. |
| **Pagination** | Opaque cursor (`page_token` in, `next_page_token` out). `limit` default 20, max 100 ([`limit.yaml`](../../../api/openapi/components/schemas/limit.yaml)). Canonical rules in [`api/openapi/readme.md`](../../../api/openapi/readme.md); `GET /schemas` is the remaining offset-based holdout. |
| **List queries** | `POST /<resource>/query` with a structured body: `{ limit, page_token, sorting: { field, direction }, filter: [ { field, operation, value } ] }`. Filter operations are a fixed enum (`equals`, `not_equals`, `contains`, `not_contains`, `less_than`, `less_than_or_equal`, `greater_than`, `greater_than_or_equal`). Fields are whitelisted per endpoint. See [ADR 031](../../adrs/031-openapi-querying.md); `POST /sessions/query` is the reference implementation. |

## Idempotency (shipped)

One-time auth operations must survive network retries without re-consuming
their single-use tokens. The three endpoints that consume one-time state accept
an optional `Idempotency-Key` header
([`idempotency-key.yaml`](../../../api/openapi/components/parameters/idempotency-key.yaml)):
retries carrying the same key within the endpoint's window return the cached
payload without consuming the token again.

```
POST /sessions/exchange
POST /auth_attempts/{id}/challenges/{challenge_id}/verify
POST /auth_attempts/{id}/handoff
```

Each endpoint documents its window in its description. No other endpoint
accepts the header today.

## Direction (not shipped)

The following conventions are target design. None of them exist in the shipped
contract — do not code against them.

- **Uniform create idempotency** — `Idempotency-Key` on ordinary resource
  creates (`POST /users`, `POST /teams`, …) with `(key, request_hash)`
  replay semantics.
- **Capabilities discovery** — a `/capabilities` endpoint with split
  unauthenticated/authenticated responses for SDK bootstrap and defaults
  discovery. The closest shipped surface is the console's
  `GET /console/runtime.json` (see console ADR 0004), which serves the
  console's own runtime config, not a general capability contract.
- **Date-based versioning** — a `Zitadel-Version` header with per-credential
  pinning. The shipped API is unversioned; breaking changes ride the alpha
  release train.
- **Rate-limit headers** — `X-RateLimit-*` on responses.
- **Expansion** — `expand=` parameters for embedding related resources.
- **Error envelope extras** — `request_id` correlation and `docs_url`
  deep-links on the error payload.

## See also

- [`../glossary.md`](../glossary.md)
- [`url-architecture.md`](url-architecture.md) — what scope resolution looks like before errors can fire
- [`authn-and-auth-flows.md`](authn-and-auth-flows.md) — where the one-time-auth idempotency applies
- [`error-details-producers.md`](error-details-producers.md) — how the server maps domain errors onto the wire envelope
