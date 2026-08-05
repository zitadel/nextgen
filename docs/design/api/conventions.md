# API Conventions

> The stuff every endpoint shares — IDs, errors, pagination, idempotency, versioning. For vocabulary, [`../glossary.md`](../glossary.md).

## Shape

| Area | Convention |
|---|---|
| **IDs** | Prefixed, opaque, dialect-minted (`prefix_<opaque>`). Prefix is part of the ID (e.g. `user_01H…`, `proj_01H…`). No scope hints encoded — the resource-scope index resolves them. Project IDs are `proj_*` ([ADR 047](../../adrs/047-dialect-id-generation.md)); the older dictionary-slug form is retired. |
| **Verbs** | `POST`, `GET`, `PATCH`, `DELETE`. Never `PUT`. |
| **Timestamps** | RFC3339 UTC strings. Never epoch millis. |
| **Response shape** | `{ object, id, … }` for single resources. `{ object: "list", data: […], pagination: {…} }` for lists. |
| **Errors** | Uniform envelope: `{ type, code, message, param, request_id, docs_url }`. Stable `code` values. `request_id` on every response. |
| **Pagination** | Opaque cursor only. Cursor encodes sort+filters; mixing cursors with different filters → 400. `limit` default 50, max 100. |
| **Filtering** | `field=value`, set membership `field=a,b,c`, suffix operators `_contains` / `_gte` / `_lte` / `_before` / `_after`. Whitelisted per endpoint. |
| **Expansion** | `expand=team,grants`, whitelisted per endpoint. Unknown values fail 400, never silently ignored. |
| **Versioning** | Date-based, header-selected via `Zitadel-Version`. **No version segment in paths.** Pinned per API key at creation and per webhook endpoint independently. |
| **Rate limits** | Enforced at the edge/API layer, per credential or source IP as appropriate. `X-RateLimit-*` headers on every response. |

## Idempotency

**LOCKED.** Idempotency cannot apply uniformly — there are two distinct categories. Every endpoint documents which one it follows.

### Category A: Idempotent resource operations

Normal creates and updates. `Idempotency-Key` header required for safe retry. `(key, request_hash)` cached 24h. Replay with same body → cached response. Different body → 409.

Applies to (non-exhaustive):

```
POST /users, /teams, /projects, /apps, /idps
POST /imports
POST /api_keys                 (creation)
POST /team_memberships
```

### Category B: One-time auth operations with replay-safe semantics

These have single-use underlying tokens but must survive network retries. `Idempotency-Key` is accepted within a narrow window (5 minutes) and returns the cached result *without* re-consuming the one-time token. Outside that window, the normal "already consumed" error.

Applies to:

```
POST /sessions/exchange
POST /auth_attempts/{id}/challenges/{challenge_id}/verify
POST /auth_attempts/{id}/handoff
```

Documented explicitly per endpoint. No endpoint silently does "the other thing."

> **Note:** 24h retention on idempotency keys for all POSTs adds up. The MVP assumes SQL-backed retention with bounded eviction; a distributed cache can be added later if measurements require it.

## Capabilities

**LOCKED.** `/capabilities` serves two audiences:

- **SDK initialisation** — needs to work before any auth.
- **Dashboard / SDK configuration** — needs defaults like the self-hosted project ID.

Split response accordingly:

**Unauthenticated** (safe for any caller):

```json
{
  "object": "capabilities",
  "mode": "cloud" | "server",
  "version": "2026-04-21",
  "features": {
    "browser_bootstrap": true,
    "oidc": true,
    "saml": true,
    "passkeys": true
  }
}
```

**Authenticated** (same endpoint, richer response):

```json
{
  "object": "capabilities",
  "mode": "server",
  "version": "2026-04-21",
  "features": { ... },
  "defaults": {
    "project_id": "proj_01HEXAMPLE",
    "team_id": "team_default"
  },
  "limits": { "users_per_project": 100000, ... }
}
```

The authenticated response is what makes the SDK self-hosted-friendly: it discovers its default project ID from the server rather than hardcoding a constant. If self-hosted ever supports multiple projects, or restores from backup with a different project ID, or runs in a clustered configuration, the SDK keeps working.

> **OPEN:** cache-control semantics. Unauthenticated response should be heavily cacheable; authenticated response is per-caller. Exact TTL and `Vary` headers to nail down.

## Versioning

Date-based version identifiers (e.g. `2026-04-21`), selected via the `Zitadel-Version` header. Two pinning points:

- **API keys** pin a version at creation time. Rotating a key is an explicit opportunity to move forward.
- **Webhook endpoints** pin independently. Upgrading your outbound payloads doesn't require rotating your inbound key.

Default when no header is sent: the caller's pinned version, or the latest GA if unpinned. Preview versions are opt-in only.

> **Note:** Independent pinning is correct but creates a matrix of version pairs to test. CI exercises cross-version combinations, not just "newest × newest."

## Errors

```json
{
  "type": "invalid_request" | "authentication_failed" | "permission_denied" | "not_found" | "rate_limited" | "conflict" | "server_error",
  "code": "origin_not_allowed",
  "message": "This origin is not allowed for this project.",
  "param": "origin",
  "request_id": "req_…",
  "docs_url": "https://zitadel.com/docs/errors/origin_not_allowed"
}
```

- `type` is the coarse category (stable, few values).
- `code` is the specific error (stable, many values). Clients branch on `code`.
- `param` points to the field if the error is input-validation.
- `request_id` appears on every response (success and failure) for support correlation.
- `docs_url` deep-links the public-facing error documentation.

## See also

- [`../glossary.md`](../glossary.md)
- [`url-architecture.md`](url-architecture.md) — what scope resolution looks like before errors can fire
- [`authn-and-auth-flows.md`](authn-and-auth-flows.md) — where Category B idempotency applies
