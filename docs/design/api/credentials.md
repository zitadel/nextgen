# Credentials

> One auth model, one `Authorization: Bearer …` header, same shape for humans in the console and machines in CI. No cookie-vs-header split. For vocabulary, [`../glossary.md`](../glossary.md).

## Bearer tokens, everywhere

Three credential types share one verification path: user tokens, service tokens (`sk_*`), and origin-bound browser challenges. Each presents as a Bearer token; the permission layer resolves the rest.

## User tokens

The user's identity. Issued to humans after login. Used by the console, CLIs, and ad-hoc scripting. The token carries identity; the request carries scope (via the resource ID or a query parameter); the server authorizes the intersection against the membership table.

Same shape whether the human is a user in the platform project (console, platform CLI) or an end-user in a customer project (customer's app calling `/me`).

## Service tokens

Pre-scoped bearer tokens; scope baked in at creation and immutable. Prefixes make scope visible at a glance:

| Prefix | Scope | Notes |
|---|---|---|
| `sk_proj_…` | Project-level operations | The workhorse. Three variants — see below. |
| `sk_team_…` | Team-scoped, narrow allowlist | See [§ sk_team_ narrow permission model](#sk_team_-narrow-permission-model--locked). Same prefix regardless of whether the team lives in the platform project or a customer project. |

Internally, scope is modelled generically (`{type, id}`) so future prefixes can be added without schema churn.

### `sk_proj_` variants

All three variants carry the same prefix and differ only by metadata bound at creation. The permission layer inspects the metadata, not the string.

| Variant | Metadata | When minted | What can it do |
|---|---|---|---|
| **Pre-claim** | `pre_claim: true` | `POST /projects` (anonymous; no human yet) | Full project authority against an unclaimed project. See [`../platform/claim-flow.md`](../platform/claim-flow.md). |
| **Claimed** | `pre_claim: false`, bound to a team | At claim — the pre-claim token is replaced by a first claimed `sk_proj_…` issued as an `api_key` bound to a team in the platform project. | Full project authority, audited under the team. |
| **Origin-scoped** | `origin_patterns: [...]` | Minted at `POST /projects` alongside pre-claim token, or separately as an `api_key` for preview deploys. | Restricted to calls whose `Origin` matches one of the declared patterns. Replaces what used to be called the "preview secret". |

> **Note:** The old `zp_…` / `zpp_…` prefixes are retired. Any cross-reference in older design notes maps: `zp_` → `sk_proj_`; `zpp_` → origin-scoped `sk_proj_`.

## `sk_team_…` narrow permission model — LOCKED

`sk_team_…` is not just "a project token with team scope." It is a constrained credential class with an explicit allowlist. Lateral movement from a team token to project administration must be mechanically impossible.

```text
sk_team_… MAY:
  team.users.read
  team.users.write            (within this team only)
  team.memberships.read
  team.memberships.write
  team.roles.assign
  team.scim.sync
  team.events.read            (filtered to this team)

sk_team_… MUST NEVER:
  project.settings.write
  projects.*.write outside its own project
  idps.write                  (project-level resource)
  apps.write                  (project-level resource)
  signing_keys.*              (project-level resource)
  allowed_origins.write       (project-level resource)
  api_keys.* outside its own team scope
  platform.*                  (cross-project — note: the platform itself is a project)
```

Enforced at the **permission-check layer** (`credential × operation → decision`), not at the endpoint layer. A team token hitting `PATCH /projects/{id}` gets 404 regardless of path — the permission check sees "team token + project.settings.write" and rejects before any resource resolution happens.

> **Note:** A single bug that lets an `sk_team_` call `PATCH /projects/{id}` is a cross-tenant admin escalation. Warrants dedicated threat modelling and a test suite that enumerates every entry in the deny list.

See also the credential × scope × permission matrix in [`authz.md`](authz.md).

## Origin-bound browser challenges

Replaces the naive "publishable key" concept. Browsers don't hold secrets — an identifier in frontend code is an identifier, not a credential. The real property we enforce is "this request comes from an origin the project has whitelisted", verified per request via the browser-enforced `Origin` header.

**Flow:**

1. Component calls `POST /bootstrap/challenge` with `{ project_id, client_type: "browser" }`.
2. Server checks `Origin` against the project's `allowed_origins`, mints a nonce bound server-side to `{project_id, origin, ttl≈60s, single_use}`.
3. Subsequent session calls echo the nonce; server re-verifies origin and burns the nonce.

**LOCKED:** `client_type` is required on every bootstrap call from day one (`browser | native_ios | native_android | server`). Browser bootstrap specifically rejects requests with missing or malformed `Origin` headers.

Client-side hashing is security theatre when all inputs are public — the nonce itself is the proof. The `Origin` header is the actual boundary.

### Mobile and native clients

Native mobile apps don't have web origins — any `Origin` header they send is spoofable. The `client_type` discriminator means we can ship MVP with browser-only verification and extend to native later without breaking the endpoint shape. Post-MVP, native clients will use:

- Platform attestation (Apple DeviceCheck / Play Integrity) bound into the challenge, or
- Strict PKCE with an attested `client_id`.

Native deep-integration is post-MVP; the discriminator is not. Until then, native clients use server-to-server flows with `sk_proj_…`.

## API keys as first-class resources

API keys are globally-addressable resources. Secret material is returned exactly once.

```http
POST /projects/{id}/api_keys
→ { id: "key_…", scope: {…}, permissions: [...], secret: "sk_proj_…" }   # first and only time secret appears

GET /api_keys/{id}
→ { id: "key_…", scope: {…}, permissions: [...], secret: null }

POST /api_keys/{id}/rotate
POST /api_keys/{id}/revoke
```

Listing happens under the scope that owns them (`GET /projects/{id}/api_keys`, `GET /teams/{id}/api_keys`). Individual key management happens flat.

## Handoff token hardening

For SSR embedding, the lit component completes auth in-browser and hands the customer's backend a short-lived `handoff_token` to exchange for a real session. Requirements:

- **Single-use**, enforced via atomic DB/Redis operation (`GETDEL`-equivalent).
- **TTL ≤ 60 seconds.**
- **Audience-bound.** The exchange call requires an `sk_proj_…` whose project ID cryptographically matches the handoff's minted project.
- **Idempotency-safe for retries.** If the exchange burns the token but the response gets dropped in flight, the backend's retry with the same `Idempotency-Key` **must return the cached session payload**, not a "token already used" error. Otherwise packet loss = user locked out. The idempotency window here is ~5 minutes; outside that window, the normal "token burned" error returns. See [`conventions.md`](conventions.md#idempotency) for Category B semantics.

The endpoint pair:

```http
POST /auth_attempts/{id}/handoff            # mints { handoff_token, exchange_url }
POST /session_handoffs/{id}/exchange        # consumes handoff_token, returns { session, session_token }
```

Detail in [`authn-and-auth-flows.md`](authn-and-auth-flows.md).

## See also

- [`../glossary.md`](../glossary.md) — canonical terms
- [`authn-and-auth-flows.md`](authn-and-auth-flows.md) — bootstrap challenge flow, handoff exchange
- [`authz.md`](authz.md) — credential × scope × permission matrix
- [`../platform/claim-flow.md`](../platform/claim-flow.md) — pre-claim → claimed `sk_proj_` transition
- [`../platform/secret.md`](../platform/secret.md) — on-disk storage of `sk_proj_` in the setup CLI flow
