# Resource Map

> The full endpoint surface grouped by concern. Flat-by-ID where a resource has a globally-unique identifier; nested under a parent otherwise. For the rule, [`url-architecture.md`](url-architecture.md). For vocabulary, [`../glossary.md`](../glossary.md).

## How to read this page

All paths are shown without a version segment — versioning is header-selected via `Zitadel-Version` (see [`conventions.md`](conventions.md#versioning)).

Standard REST semantics apply: `POST` on the collection creates, `GET` on the collection lists (scope required — see [`url-architecture.md`](url-architecture.md#scope-resolution-as-a-first-class-invariant)), `GET`/`PATCH`/`DELETE` on the item reads/updates/deletes. Action verbs use slash form (`POST /users/{id}/verify_email`).

---

## Projects

A project is a tenant / deployment. One project is reserved as the **platform project** — discoverable via `/capabilities`.

```http
/projects
/projects/{id}
/projects/{id}/branding
/projects/{id}/domains
/projects/{id}/features
/projects/{id}/allowed_origins
/projects/{id}/signing_keys
/projects/{id}/api_keys
/projects/{id}/webhooks
```

---

## Teams

Teams live inside projects. A team in the platform project is a paying developer account; a team in a customer project is a B2B end-customer tenant. Same resource, different context.

```http
/teams/{id}
/teams/{id}/memberships         # list/create within a team
/teams/{id}/invitations
/teams/{id}/billing             # only meaningful for teams in the platform project
/teams/{id}/api_keys
```

Create/list with explicit scope:

```http
POST /teams                     # body: { project_id, name, ... }
GET  /teams?project_id=…
```

---

## Users

Users live inside projects. A user in the platform project is a developer/admin; a user in a customer project is an end-user.

```http
/users/{id}
/me                             # resolves to the calling user
/me/memberships                 # every team_membership the caller holds
```

Create/list with explicit scope:

```http
POST /users                     # body: { project_id, email, ... }
GET  /users?project_id=…&q=…&limit=…
```

---

## Memberships

One membership kind: a user is a member of a team with roles.

```http
/team_memberships/{id}
POST /team_memberships          # body: { team_id, user_id, roles: [...] }
```

---

## Credentials (globally addressable)

API keys are first-class resources with their own URL. Listing happens under the scope that owns them (`/projects/{id}/api_keys`, `/teams/{id}/api_keys`).

```http
/api_keys/{id}
/api_keys/{id}/rotate
/api_keys/{id}/revoke
```

Detail in [`credentials.md`](credentials.md).

---

## Other identity resources

```http
/apps/{id}                      # OIDC/SAML relying parties
/idps/{id}
/grants/{id}
/app_groups/{id}                # what used to be called "project" (the authz container)
```

> **OPEN:** product decomposition of `app_groups`. Today's "project" conflates "group of related apps" and "role/permission container" — these might be separable and cleaner as distinct resources. Flagged for product review, not blocking API design.

---

## Auth flows

Scope derived from payload; full walk-through in [`authn-and-auth-flows.md`](authn-and-auth-flows.md).

```http
POST /bootstrap/challenge                # { project_id, client_type }
POST /auth_attempts                      # { project_id, challenge_nonce, session_id? }
GET  /auth_attempts/{id}
POST /auth_attempts/{id}/challenges
POST /auth_attempts/{id}/challenges/{challenge_id}/verify
POST /auth_attempts/{id}/handoff
POST /session_handoffs/{id}/exchange
```

---

## Sessions (durable, post-auth only)

```http
POST   /sessions                         # optional anonymous pre-auth shell
GET    /sessions                         # list (admin / management)
GET    /sessions/{id}
DELETE /sessions/{id}                    # logout
```

Sessions carry factors + ACR. Detail in [`../flowengine/session-api.md`](../flowengine/session-api.md).

---

## Flow engine runtime

The UI-orchestration layer that runs on top of auth_attempts. Detail in [`../flowengine/flow-engine.md`](../flowengine/flow-engine.md).

```http
POST /flows
GET  /flows/{session_id}
POST /flows/{session_id}/submit
POST /flows/{session_id}/event
```

Flow definition management (uploaded via `npx zitadel push`):

```http
POST   /flow_definitions
GET    /flow_definitions/{id}
PATCH  /flow_definitions/{id}
DELETE /flow_definitions/{id}
POST   /flow_definitions/{id}/activate
POST   /flow_definitions/{id}/archive
POST   /flow_definitions/{id}/validate
POST   /flow_definitions/{id}/simulate
```

---

## Events and audit

```http
/events/{id}                             # identity events (sign-in, password change)
/events?project_id=…
/audit_events/{id}                       # admin/configuration changes
/audit_events?team_id=…
```

---

## Imports and bulk

```http
POST /imports                            # body: { type: "users" | "teams" | ..., ... }
GET  /imports/{id}
GET  /imports/{id}/errors
```

No generic `/batch`. Resource-specific bulk endpoints only when demand is real.

---

## Caller convenience

```http
GET /me
GET /me/memberships
GET /capabilities                        # split public/authenticated — see conventions.md
```

---

## Hosted protocol surfaces

Legacy / interop protocols. The REST API above is the primary surface; these sit alongside.

```http
# OIDC
/.well-known/openid-configuration
/authorize                               # OIDC Adapter stores auth_request, drives auth_attempts internally
/token
/userinfo
/end_session

# SAML
/saml/sso
/saml/acs
/saml/metadata

# SCIM
/scim/v2/Users
/scim/v2/Groups
```

---

## Debug

Pre-platform, no auth.

```http
GET /debug/healthz
GET /debug/readyz
```

---

## Project context reference

Quick lookup for which project a given use case targets.

| Use case | Project context | Notes |
|---|---|---|
| A developer signs in to the console | Platform project | Resolves via `/capabilities` `defaults.project_id`. |
| A paying team adds a developer | Platform project | `POST /team_memberships` with `team_id` pointing at the paying team. |
| A customer creates a project | Customer project (the new one) | `POST /projects` mints the resource; claim later attaches it to a platform-project team. |
| A customer adds a B2B tenant | Customer project | `POST /teams` with `project_id` = the customer project. |
| An end-user signs up in the customer's app | Customer project | `POST /users` with `project_id` = the customer project. |

---

## Search, bulk, aggregation — MVP scope

| Area | Status |
|---|---|
| **Search** | **LOCKED.** Ship `?q=` (server-defined fuzzy match on common fields) plus typed filters for MVP. Defer the Stripe-style query DSL to post-MVP `POST /search` endpoints. |
| **Bulk** | **LOCKED.** No generic `/batch`. Async `POST /imports` for migration; resource-specific bulk endpoints only when demand is real. |
| **Cross-project aggregation** | **LOCKED.** Drop at MVP. Aggregated endpoints are console-internal only until there's a clear customer-facing need. |

---

## OpenAPI specs

The source of truth for request/response shapes:

- [`../platform/api/claim-api.yaml`](../platform/api/claim-api.yaml) — projects, claim, team domain-match.
- [`../platform/api/config-api.yaml`](../platform/api/config-api.yaml) — `npx zitadel push` upload, capability manifest, drift.
- [`../flowengine/api/flow-api.yaml`](../flowengine/api/flow-api.yaml) — flow engine runtime.
- [`../flowengine/api/session-api.yaml`](../flowengine/api/session-api.yaml) — sessions.

auth_attempts, api_keys (flat), events, audit_events, imports, capabilities: **TODO — not yet specified.**

> **OPEN:** OpenAPI server variable. `{region}` matches claim-api.yaml but reads awkwardly for single-node self-hosted. `{host}` is a candidate.

## See also

- [`../glossary.md`](../glossary.md)
- [`url-architecture.md`](url-architecture.md) — flat vs nested rule, no version segment
- [`authn-and-auth-flows.md`](authn-and-auth-flows.md) — auth_attempts detail
- [`credentials.md`](credentials.md) — api_keys, `sk_*` tokens
