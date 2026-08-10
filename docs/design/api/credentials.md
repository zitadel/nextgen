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
| **Claimed** | `pre_claim: false`, bound to a team | At claim — the pre-claim token is replaced by a first claimed `sk_proj_…` bound to a team in the platform project. | Full project authority, audited under the team. |
| **Origin-scoped** | `origin_patterns: [...]` | Minted at `POST /projects` alongside pre-claim token, or later for preview deploys once a management API exists. | Restricted to calls whose `Origin` matches one of the declared patterns. Replaces what used to be called the "preview secret". |

> **Note:** The old `zp_…` / `zpp_…` prefixes are retired. Any cross-reference in older design notes maps: `zp_` → `sk_proj_`; `zpp_` → origin-scoped `sk_proj_`.

## `sk_team_…` narrow permission model — LOCKED

`sk_team_…` is not just "a project token with team scope." It is a constrained credential class with an explicit allowlist. Anything not listed under **MAY** is denied; **MUST NEVER** emphasizes high-risk names. Lateral movement from a team token to project administration must be mechanically impossible.

```text
sk_team_… MAY:
  team.read                          (own team only — resolver-enforced team
                                      scope; metadata / identity of the token's
                                      team, not team administration)
  user.read, user.write              (within this team only; profile edits only,
                                      NOT user.set_password)
  team_membership.read, team_membership.write
                                     (not .create / .delete — roster add/remove
                                      and invitations require a user token)
  events.read                        (filtered to this team)

sk_team_… MUST NEVER:
  user.set_password                  (account takeover — human/owner op only)
  project.*
  branding.*
  domain.*
  feature.*
  allowed_origin.*
  signing_key.*
  webhook.*
  team.create, team.write, team.delete
                                     (creating/renaming/deleting the team is
                                      human/team_admin territory; team.read of
                                      the token's own team is under MAY)
  billing.*
  idp.*
  app.*
  app_group.*
  grant.*
  schema.*
  flow_definition.*
  session.*
  auth_attempt.*
  import.*
  platform.*                         (cross-project — note: the platform itself is a project)
```

Permission names follow the flat `{resource}.{verb}` convention in [`system-permission-catalog.md`](system-permission-catalog.md). Multi-word types use `_` (`team_membership`, not `team.membership`). Project-scoped configuration resources have independent permissions (`branding.*`, `domain.*`, `feature.*`, `allowed_origin.*`, `signing_key.*`, `webhook.*`); all are explicitly denied to `sk_team_`.

Flat `user.*` / `team_membership.*` no longer encode the team boundary in the
permission string (old `team.users.*` did). Compensating requirement: every
`sk_team_` grant must carry a resolver-enforced team scope, and the deny-list
suite must include "team token reads/writes a user outside its team".

SCIM sync (`scim.sync`) is not listed yet — SCIM is a hosted interop surface
(`/scim/v2/Users`, `/scim/v2/Groups` in [`resource-map.md`](resource-map.md))
with no **management-permission** mapping yet. Park until that is designed.

`api_key.*` is likewise not listed — first-class API-key management is parked
in the [system catalog open questions](system-permission-catalog.md#open-questions);
bootstrap `sk_*` minting does not go through that resource.

Enforced at the **permission-check layer** (`credential × operation → decision`), not at the endpoint layer. A team token hitting `PATCH /projects/{id}` gets 404 regardless of path — the permission check sees "team token + project.write" and rejects before any resource resolution happens.

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

## API keys as first-class resources — PARKED

> **Parked** pending product decision (see
> [`system-permission-catalog.md` open questions](system-permission-catalog.md#open-questions)):
> first-class `api_key` CRUD vs OAuth2 client-credentials vs secret-rotate-only.
> Opaque `sk_proj_` / `sk_team_` **service tokens** still exist (bootstrap at
> project create/claim). Do not treat the sketch below as a locked permission
> or OpenAPI contract.

Earlier design sketch (inventory only):

```http
POST /projects/{id}/api_keys
→ { id: "key_…", scope: {…}, permissions: [...], secret: "sk_proj_…" }   # first and only time secret appears

GET /api_keys/{id}
→ { id: "key_…", scope: {…}, permissions: [...], secret: null }

POST /api_keys/{id}/rotate
POST /api_keys/{id}/revoke
```

Listing would happen under the scope that owns them (`GET /projects/{id}/api_keys`, `GET /teams/{id}/api_keys`). Individual key management would be flat.

## Handoff token hardening

For SSR embedding, the lit component completes auth in-browser and hands the customer's backend a short-lived `handoff_token` to exchange for a real session. Requirements:

- **Single-use**, enforced with an atomic SQL-backed consume operation. A distributed cache can be added later if measured traffic needs it.
- **TTL ≤ 60 seconds.**
- **Audience-bound.** The exchange call requires an `sk_proj_…` whose project ID cryptographically matches the handoff's minted project.
- **Idempotency-safe for retries.** If the exchange burns the token but the response gets dropped in flight, the backend's retry with the same `Idempotency-Key` **must return the cached session payload**, not a "token already used" error. Otherwise packet loss = user locked out. The idempotency window here is ~5 minutes; outside that window, the normal "token burned" error returns. See [`conventions.md`](conventions.md#idempotency) for Category B semantics.

The endpoint pair:

```http
POST /auth_attempts/{id}/handoff            # mints a handoff_token
POST /sessions/exchange                     # consumes it, returns a session
```

Detail in [`authn-and-auth-flows.md`](authn-and-auth-flows.md).

## See also

- [`../glossary.md`](../glossary.md) — canonical terms
- [`authn-and-auth-flows.md`](authn-and-auth-flows.md) — bootstrap challenge flow, handoff exchange
- [`authz.md`](authz.md) — credential × scope × permission matrix
- [`system-permission-catalog.md`](system-permission-catalog.md) — canonical system permission names and `sk_team_` constraints
- [`../platform/claim-flow.md`](../platform/claim-flow.md) — pre-claim → claimed `sk_proj_` transition
- [`../platform/secret.md`](../platform/secret.md) — on-disk storage of `sk_proj_` in the setup CLI flow
