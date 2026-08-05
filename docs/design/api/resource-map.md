# Resource Map

> The full endpoint surface grouped by concern. Flat-by-ID where a resource has a globally-unique identifier; nested under a parent otherwise. For the rule, [`url-architecture.md`](url-architecture.md). For vocabulary, [`../glossary.md`](../glossary.md).

## How to read this page

All paths are shown without a version segment — versioning is header-selected via `Zitadel-Version` (see [`conventions.md`](conventions.md#versioning)).

Standard REST semantics apply: `POST` on the collection creates, `GET` on the collection lists (scope required — see [`url-architecture.md`](url-architecture.md#scope-resolution-as-a-first-class-invariant)), and `GET`/`PATCH` on the item reads/updates. `DELETE` on managed resources runs the resource's lifecycle semantics first (usually deactivate/tombstone); it is not a blind SQL hard-delete. Action verbs use slash form (`POST /users/{id}/verify_email`).

---

## Projects

A project is a tenant / deployment. One project is reserved as the **platform project** — discoverable via `/capabilities`.

```http
/projects
/projects/{id}
/projects/{id}/domains
/projects/{id}/features
/projects/{id}/allowed_origins
/projects/{id}/signing_keys
/projects/{id}/api_keys
/projects/{id}/webhooks
```

Branding is project-scoped but flat by revision id — see [Branding](#branding).

---

## Branding

Immutable per-project login-appearance revisions (ADR 040). Create publishes a
new revision; there is no update or delete. Flow responses resolve the latest
revision for the project.

```http
/branding
/branding/{id}
```

Create/list are project-scoped (project id on the request, matching OpenAPI):

```http
POST /branding                  # publish a new revision
GET  /branding                  # list revisions for the project, newest first
GET  /branding/{id}
```

Permission names in
[`system-permission-catalog.md`](system-permission-catalog.md#project-scoped-configuration).

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

`DELETE /teams/{id}` deactivates/tombstones the team, revokes team-scoped API
keys, and deactivates/removes memberships. Self-owned users survive. Users whose
lifecycle owner is the deleted team are deactivated according to policy.
See [ADR 024](../../adrs/024-user-team-lifecycle-ownership.md).

---

## Users

Users live inside projects. A user in the platform project is a developer/admin; a user in a customer project is an end-user. Users do not live inside teams; memberships attach users to teams.

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

`DELETE /users/{id}` deactivates/tombstones the user, revokes sessions, tokens,
and credentials, and deactivates memberships. Teams and resources the user
created or administered are preserved unless a resource-specific cleanup policy
says otherwise.

---

## Memberships

One membership kind: a user is a member of a team with roles and membership
status. Membership is team roster/status/provisioning state. FGA may consume it
as an authorization fact, but membership is not proof that the team owns the
user's identity lifecycle.

```http
/team_memberships/{id}
POST /team_memberships          # body: { team_id, user_id, roles: [...] }
DELETE /team_memberships/{id}
```

`DELETE /team_memberships/{id}` removes access to that team. It only
deprovisions the user if that membership is the configured lifecycle-owner
relationship and policy requires deprovisioning.

---

## User schemas

User profile / directory schema definitions — the field structure that user
records follow. Only user schemas exist today; the collection is project-scoped.

```http
/schemas
/schemas/{id}
```

Create/list with explicit scope:

```http
POST /schemas                   # create a user schema
GET  /schemas?project_id=…&object_type=…
GET  /schemas/{id}
```

`PATCH`/`DELETE /schemas/{id}` are **not yet exposed** — create, list, and get
only. Permission names in
[`system-permission-catalog.md`](system-permission-catalog.md#schemas-user-schemas).

---

## Credentials (globally addressable)

> **Parked as a management resource** — see
> [`system-permission-catalog.md` open questions](system-permission-catalog.md#open-questions)
> and [`credentials.md`](credentials.md#api-keys-as-first-class-resources--parked).
> Opaque `sk_*` service tokens remain; first-class `/api_keys` CRUD is not catalog
> contract yet. URL inventory below is design sketch only.

```http
/api_keys/{id}
/api_keys/{id}/rotate
/api_keys/{id}/revoke
```

Listing under the owning scope (`/projects/{id}/api_keys`, `/teams/{id}/api_keys`)
was part of the same sketch. Detail in [`credentials.md`](credentials.md).

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
POST /sessions/exchange
```

---

## Sessions (durable, post-auth only)

```http
POST   /sessions                         # optional anonymous pre-auth shell
GET    /sessions                         # list (admin / management)
GET    /sessions/{id}                    # operator get
DELETE /sessions/{id}                    # operator revoke (not logout)
GET    /sessions/me                      # end-user get (`nextgenSession` cookie)
DELETE /sessions/me                      # end-user logout (`nextgenSession` cookie)
```

Sessions carry factors + `assurance_levels[]`. Clients read and revoke
sessions; factor changes flow through `auth_attempts`. Detail in
[`../flowengine/session-api.md`](../flowengine/session-api.md).

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
GET    /flow_definitions
GET    /flow_definitions/{id}
PUT    /flow_definitions/{id}
DELETE /flow_definitions/{id}
POST   /flow_definitions/{id}/activate
POST   /flow_definitions/{id}/deactivate
# planned: POST /flow_definitions/{id}/validate
# planned: POST /flow_definitions/{id}/simulate
```

---

## Events and audit

Unified wide-event audit stream. See [ADR 048](../../adrs/048-wide-events-internal-audit-primitive.md)
(internal model) and [ADR 049](../../adrs/049-events-api-retention-export.md) (API,
retention, export).

```http
GET /events/{id}              # scope via resource_scope_index before load
GET /events?project_id=…
         &category=…          # request | auth | session | admin | entity | signal
         &event_type=…
         &actor_id=…
         &client_id=…
         &session_id=…
         &flow_id=…
         &request_id=…
         &fingerprint=…
         &entity_type=…
         &entity_id=…
         &team_id=…           # emit-time team scope filter
         &created_after=…
         &created_before=…
         &page_token=…
```

`GET /events/{id}` resolves `project_id` / `team_id` from the global
resource-scope index before authorization and row load (same flat-by-ID pattern
as other resources; see [url-architecture.md](url-architecture.md)). List/get
authorization uses emit-time `team_id` stored on the event, not recomputed
membership.

`category=admin` covers admin and configuration changes (formerly sketched as
`/audit_events`). `category=auth` and `category=session` cover sign-in, token,
and session lifecycle events.

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

## Draft API specs

Draft request/response sketches for this design PR:

- [`../platform/api/claim-api.yaml`](../platform/api/claim-api.yaml) — projects, claim, team domain-match.
- [`../platform/api/config-api.yaml`](../platform/api/config-api.yaml) — `npx zitadel push` upload, capability manifest, drift.
- [`../flowengine/api/flow-api.yaml`](../flowengine/api/flow-api.yaml) — flow engine runtime.
- [`../flowengine/api/session-api.yaml`](../flowengine/api/session-api.yaml) — sessions.

auth_attempts, api_keys (flat), imports, capabilities: **TODO — not yet specified.**

events: partially specified via [ADR 049](../../adrs/049-events-api-retention-export.md);
OpenAPI sketch pending.

Implementation OpenAPI source remains under `api/openapi/**`; generated Go code
continues to come from that source, not from these design sketches.

> **OPEN:** OpenAPI server variable. `{region}` matches claim-api.yaml but reads awkwardly for single-node self-hosted. `{host}` is a candidate.

## See also

- [`../glossary.md`](../glossary.md)
- [`url-architecture.md`](url-architecture.md) — flat vs nested rule, no version segment
- [`authn-and-auth-flows.md`](authn-and-auth-flows.md) — auth_attempts detail
- [`credentials.md`](credentials.md) — api_keys, `sk_*` tokens
- [`system-permission-catalog.md`](system-permission-catalog.md) — required permission names
