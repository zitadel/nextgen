# System Permission Catalog

> The canonical list of Zitadel-owned (system catalog) permissions for internal
> API resources. Implements [ADR 032 §1](../../adrs/032-permission-catalogs.md#1-one-model-two-catalogs)
> and [ADR 033 §1](../../adrs/033-internal-permission-management.md#1-system-catalog).
> For scope resolution, [`url-architecture.md`](url-architecture.md).
> For the permission-check invariant, [`authz.md`](authz.md).
> For canonical permission names, this document is the source of truth; endpoint
> inventory lives in [`resource-map.md`](resource-map.md).

## Decisions (locked for this draft)

- **Naming:** flat `{resource}.{verb}`, singular resource (OpenFGA-shaped type
  name). Scope (which project/team) comes from the grant / credential, not
  from nesting in the permission string.
- **Delimiter:** `.` (already used in OpenAPI), not Auth0-style `verb:resource`.
- **`read` covers get + list** for every resource in this draft, including
  users. A later split (e.g. directory / non-PII roster vs full PII detail) is
  explicitly deferred — see [§ Open questions](#open-questions).
- **Project-scoped configuration resources are separate permissions.** Branding,
  domains, features, allowed origins, signing keys, and webhooks use
  `branding.*`, `domain.*`, `feature.*`, `allowed_origin.*`, `signing_key.*`,
  and `webhook.*`. Their project grant supplies scope; `project.read` /
  `project.write` do not imply them.
- **Compound resource types use `_`.** Multi-word types match the API/FGA name
  (`team_membership`, `flow_definition`, `api_key`). No dot nesting
  (`team.membership.*`) — that would imply `team.write` covers child ops.
- **Users and team memberships are separate resources.** Old names like
  `team.users.read` nested *where* into the permission. The replacement is
  flat `user.*` and `team_membership.*` evaluated at the team (or project)
  grant boundary — see [§ Nested name replacements](#nested-name-replacements).
- **Create vs write split** — only on [provisioning-boundary](#create-vs-write)
  resources (plus `grant`) where grant boundaries already depend on it.
  Elsewhere `write` means create *and* manage — there is no separate `.create`
  (matches OpenAPI `*.write`).

## Naming convention

```
{resource}.{verb}
```

- **resource** — singular, matching the resource type, not the URL collection.
- **verb** — one of the standard verbs below, or a resource-specific action verb.
- **No nesting** for parent/child or scope. Flat permission + grant scope.

### Standard verbs

| Verb | Meaning |
|---|---|
| `create` | Create a new resource (`POST` on a collection). |
| `read` | Read a single resource or list resources of this type. |
| `write` | Meaning depends on the resource's [verb-model class](#create-vs-write). On **provisioning-boundary** / **soft-split** resources: mutate an **existing** resource only — does **not** imply `create` or `delete`. On **manage** and **runtime** resources: OpenAPI `*.write` semantics — create *and* manage / start *and* mutate (no separate `.create`). For singleton project-scoped config, the first write may establish config if none exists — still `write`. |
| `delete` | Remove / tombstone a resource. |

Resource-specific action verbs are added only when a standard verb is
insufficient (e.g. `api_key.rotate`, `api_key.revoke`).

### Create vs write

Split **`create`** from **`write`** only where a real grant boundary separates
“bring a new entity into existence” from “edit an existing one” — **provisioning
boundaries**. Collapsing them on those resources breaks load-bearing RBAC (see
default bundles and `sk_team_`).

**OpenAPI reality:** several resources still declare a single `.write` scope
meaning “create and manage.” The catalog names below are the **target** model;
see [§ Drift notes](#drift-notes).

| Class | Meaning |
|---|---|
| **provisioning-boundary** | `create` ≠ `write` is **normative now** — bundles or credential classes already depend on it. |
| **soft split** | `create` vs `write` is useful for custom grants; default bundles may grant both. |
| **manage** | No `create`/`write` split — `write` means create *and* manage (`read`, `write`, and `delete` where a delete endpoint exists). Matches OpenAPI `*.write` = create-and-manage. Split only if a real RBAC boundary emerges. |
| **action-verbs** | No generic `write`; use `create`, `delete`, and resource-specific verbs. |
| **read-write-only** | No create/delete lifecycle (e.g. billing subscription state). |
| **job-lifecycle** | `create` + `read` only (async job). |
| **read-only** | No mutations in this catalog. |
| **runtime** | Auth/session plane; catalog names for consistency; not admin provisioning RBAC. |

| Resource | Class | Why |
|---|---|---|
| `project` | provisioning-boundary | Editing settings (`write`) vs removal (`delete`); `team_admin` has no `project.*`. `create` gates the authenticated / on-prem creation path; cloud self-service uses the anonymous `POST /projects` bootstrap + claim (outside this permission). See [open questions](#open-questions). |
| `team` | provisioning-boundary | **`team_admin` has `team.write` but not `team.create`** — only `project_admin` creates teams (new tenant boundary). |
| `user` | provisioning-boundary | Onboarding/SCIM (`create`) vs profile edits (`write`). Plus a **credential-tier** split: `user.set_password` (account-takeover-grade) is separate from `user.write`. Stock admin bundles grant all three; custom grants can hold `user.write` alone. |
| `team_membership` | provisioning-boundary | Invites/direct add (`create`) vs role change (`write`). **`sk_team_` grants `.write` but not `.create`/`.delete`.** |
| `grant` | soft split | New access binding (`create`) vs change existing binding (`write`) — delegation control. |
| `api_key` | action-verbs | `create`, `read`, `delete`, `rotate`, `revoke` — no `api_key.write`. |
| `signing_key` | action-verbs | `create`, `read`, `delete` — manual rotation creates a successor; emergency replacement creates the successor before deleting the compromised key. |
| `billing` | read-write-only | Tier/subscription/payment — no `billing.create`. |
| `branding` | manage | Immutable revisions: `write` publishes a revision; no update or delete. Already matches OpenAPI. |
| `domain`, `allowed_origin`, `webhook` | manage | Project-scoped collections; `write` creates and manages, with separate `delete`. |
| `feature` | read-write-only | Project feature configuration has no independent create/delete lifecycle. |
| `import` | job-lifecycle | Start job (`create`); poll status (`read`). |
| `event`, `audit_event` | read-only | |
| `session`, `auth_attempt` | runtime | App-plane `*.write` only (no separate `*.create` — OpenAPI `*.write` covers start + mutate). Operator: `session.read` / `session.delete`. |
| `app`, `idp`, `app_group`, `schema`, `flow_definition` | manage | No create/write split — `write` = create + manage; `read`, `write`, `delete` (where exposed). Matches OpenAPI (`*.write` = create-and-manage; `flow_definition.delete` separate). |

---

## Permission catalog

### Projects

> **Verb model:** provisioning-boundary — `create` ≠ `write` is normative.

| Permission | Endpoints | Notes |
|---|---|---|
| `project.create` | `POST /projects` (authenticated / on-prem path) | Two creation modes share this URL. **Cloud self-service:** anonymous `POST /projects` (`security: []`) + claim flow — no catalog permission (see [`../platform/claim-flow.md`](../platform/claim-flow.md)). **On-prem / admin-provisioned:** authenticated `POST /projects` gated by `project.create`, no claim — the platform project + default team are seeded at install ([`hierarchy.md`](hierarchy.md#self-hosted-exposes-the-same-api-shape-as-cloud)). How one endpoint reconciles both gatings is an [open question](#open-questions). |
| `project.read` | `GET /projects`, `GET /projects/{id}` | Project resource only. Does not imply project-scoped configuration permissions. |
| `project.write` | `PATCH /projects/{id}` | Project attributes only. Does not imply `branding.*`, `domain.*`, `feature.*`, `allowed_origin.*`, `signing_key.*`, or `webhook.*`. |
| `project.delete` | `DELETE /projects/{id}` | |

Project-scoped configuration resources remain scoped through the project grant,
but require their own permissions below. Bundles provide convenient aggregate
access without making `project.*` an inheritance mechanism.

### Project-scoped configuration

These permissions are independent even where the URL remains nested below a
project. Branding is shipped; the other endpoint mappings are the target
catalog for the planned paths in [`resource-map.md`](resource-map.md#projects).

| Permission | Endpoints / intended operations | Notes |
|---|---|---|
| `branding.read` | `GET /branding`, `GET /branding/{id}` | Read/list immutable branding revisions. |
| `branding.write` | `POST /branding` | Publish a new immutable revision; no separate create/delete permission. |
| `domain.read` | Read/list `/projects/{id}/domains` | Domain context known to Zitadel; does not imply DNS/TLS infrastructure management. |
| `domain.write` | Add/update a domain | Create + manage. |
| `domain.delete` | Remove a domain | |
| `feature.read` | Read `/projects/{id}/features` | |
| `feature.write` | Change project feature configuration | No create/delete lifecycle. |
| `allowed_origin.read` | Read/list `/projects/{id}/allowed_origins` | |
| `allowed_origin.write` | Add/update an allowed origin | Create + manage. |
| `allowed_origin.delete` | Remove an allowed origin | |
| `signing_key.create` | Create a successor signing key | Manual rotation; activation follows [ADR 039](../../adrs/039-signing-key-rotation-and-incident-response.md). |
| `signing_key.read` | Read/list `/projects/{id}/signing_keys` | Public/status metadata only; never exposes private key material. |
| `signing_key.delete` | Delete a signing key | Includes emergency removal after a successor exists. |
| `webhook.read` | Read/list `/projects/{id}/webhooks` | |
| `webhook.write` | Create/update a webhook | Create + manage. |
| `webhook.delete` | Remove a webhook | |

Some configuration may continue to be delivered through `zitadel push` rather
than resource-specific REST endpoints; the pushed operation must still require
the corresponding resource permission.

### Teams

> **Verb model:** provisioning-boundary — `team_admin` has `team.write` but not `team.create`.

| Permission | Endpoints | Notes |
|---|---|---|
| `team.create` | `POST /teams` | |
| `team.read` | `GET /teams`, `GET /teams/{id}` | Team resource only. Does **not** imply `team_membership.*` or `user.*`. |
| `team.write` | `PATCH /teams/{id}` | Team attributes only. Does **not** imply `team_membership.*`, invitations, or billing. |
| `team.delete` | `DELETE /teams/{id}` | |

### Users

> **Verb model:** provisioning-boundary — split normative for custom grants;
> `team_admin` / `project_admin` include `user.create` / `user.write` /
> `user.set_password` / `user.delete`. **Credential-tier split:** admin
> credential ops (set/reset password) are a separate permission, not part of
> `user.write`.

| Permission | Endpoints | Notes |
|---|---|---|
| `user.create` | `POST /users` | |
| `user.read` | `GET /users`, `GET /users/{id}` | Get + list; full representation for now. |
| `user.write` | `PATCH /users/{id}`, non-credential action verbs (e.g. `verify_email`) | Profile / attribute edits. Does **not** include setting another user's password — see `user.set_password`. |
| `user.set_password` | `PUT /users/{id}/password` | **Credential-tier, account-takeover-grade.** Admin sets/resets *another* user's password. Held separately so a profile-editor / help-desk role can hold `user.write` without it. OpenAPI tags this endpoint `user.write` today (see [Drift notes](#drift-notes)). Reserve `user.reset_mfa` / similar for future admin factor-reset endpoints. |
| `user.delete` | `DELETE /users/{id}` | |

`/me` and `/me/memberships` are self-access and do not require system
permissions — they are gated by the session/credential itself. A user changing
their **own** password/factors is self-service (`/me`-gated), **not**
`user.set_password`.

**Factor lifecycle** (passkey / OTP / recovery-code enroll, verify, remove) is
**not** a `user.*` permission — factor mutations flow through `auth_attempts`
(self-service / nonce-gated); see
[`authn-and-auth-flows.md`](authn-and-auth-flows.md). Do not add a
`user.manage_factors` catalog permission.

### Team memberships

> **Verb model:** provisioning-boundary — invites → `create`; role edits → `write`; `sk_team_` excludes `.create`/`.delete`.

| Permission | Endpoints | Notes |
|---|---|---|
| `team_membership.create` | `POST /teams/{id}/memberships`, `POST /team_memberships` | Prefer nested create; flat create with `team_id` in body is legacy. |
| `team_membership.read` | `GET /teams/{id}/memberships`, `GET /team_memberships/{id}` | |
| `team_membership.write` | `PATCH /team_memberships/{id}` | Role changes within a membership (replaces old `team.roles.assign`). |
| `team_membership.delete` | `DELETE /team_memberships/{id}` | |

### Team invitations (MVP: folded)

Invitations are **pre-membership** state: send, list, resend, revoke before the
invitee accepts. Accepting an invite creates a `team_membership` (usually
self-service via the invite token, not an admin permission).

For MVP, invitation management folds into `team_membership.create` (send /
direct add) and `team_membership.delete` (revoke pending or remove member).
Split to `invitation.*` later if a role should invite without
`team_membership.write` (e.g. HR can invite, only admins change roles).

**`sk_team_` note:** the team credential allowlist grants
`team_membership.read` and `.write` only — not `.create` or `.delete`. Roster
add/remove and invitation send/revoke require a user token (e.g. `team_admin`
bundle), not a team machine token. Intentional unless product revisits.

Planned nested path: `/teams/{id}/invitations` (see [`resource-map.md`](resource-map.md)).

### Billing (platform project — explicit, not folded)

> **Verb model:** read-write-only — no `billing.create`.

Billing applies only to teams in the **platform project** (paying developer
accounts). It is **not** folded into `team.write` — finance/governance should
not require full team mutation.

HTTP surface is still placeholder (`/teams/{id}/billing` in resource-map only).
Planned permissions once specified:

| Permission | Intended operations | Notes |
|---|---|---|
| `billing.read` | View tier, subscription status, seat usage, invoices/receipts | From platform docs: Free / Pro / Enterprise tiers, seat counts. |
| `billing.write` | Change plan/tier, payment method, billing contact | Gated to team owner (see [`platform/secret.md`](../platform/secret.md) capability matrix). Claim attaches the billing relationship. |

Until endpoints exist, treat `billing.*` as reserved catalog names — do not
grant them via `team.write`.

### API keys

> **Verb model:** action-verbs — no `api_key.write`.

| Permission | Endpoints | Notes |
|---|---|---|
| `api_key.create` | `POST /projects/{id}/api_keys`, `POST /teams/{id}/api_keys` | Scope determines project vs team key. |
| `api_key.read` | `GET /projects/{id}/api_keys`, `GET /teams/{id}/api_keys`, `GET /api_keys/{id}` | |
| `api_key.delete` | `DELETE /api_keys/{id}` | |
| `api_key.rotate` | `POST /api_keys/{id}/rotate` | Action verb. |
| `api_key.revoke` | `POST /api_keys/{id}/revoke` | Action verb. |

### Apps

> **Verb model:** manage — `write` = create + manage (no `app.create`).

| Permission | Endpoints | Notes |
|---|---|---|
| `app.read` | `GET /apps/{id}` | |
| `app.write` | `POST /apps`, `PATCH /apps/{id}` | Create + manage. |
| `app.delete` | `DELETE /apps/{id}` | |

### Identity providers

> **Verb model:** manage — `write` = create + manage (no `idp.create`).

| Permission | Endpoints | Notes |
|---|---|---|
| `idp.read` | `GET /idps/{id}` | |
| `idp.write` | `POST /idps`, `PATCH /idps/{id}` | Create + manage. |
| `idp.delete` | `DELETE /idps/{id}` | |

### App groups

> **Verb model:** manage — `write` = create + manage (no `app_group.create`).

| Permission | Endpoints | Notes |
|---|---|---|
| `app_group.read` | `GET /app_groups/{id}` | |
| `app_group.write` | `POST /app_groups`, `PATCH /app_groups/{id}` | Create + manage. |
| `app_group.delete` | `DELETE /app_groups/{id}` | |

### Grants (access bindings)

> **Verb model:** soft split — `create` vs `write` useful for delegation; default bundles grant full CRUD.

A **grant** is an explicit access record: who may access what, at which scope
(user ↔ app, team ↔ project, user ↔ role in an app_group, or a raw permission
assignment). This is the `/grants` management resource — **not** OAuth
`grant_type` on `/oauth/token`.

| Permission | Endpoints | Notes |
|---|---|---|
| `grant.create` | `POST /grants` | Bind a principal to an app, role, or permission at a scope. |
| `grant.read` | `GET /grants/{id}` | |
| `grant.write` | `PATCH /grants/{id}` | Update an existing binding (e.g. role change on an app grant). |
| `grant.delete` | `DELETE /grants/{id}` | Revoke access. |

### Schemas (user schemas)

> **Verb model:** manage — `write` = create + manage (no `schema.create`); matches OpenAPI `schema.write`.

User profile / directory schema definitions. URL stays `/schemas`; permission
prefix is `schema.*` for now. Rename to `user_schema.*` is optional if another
schema type appears — same compound-type rule as `team_membership`. Endpoints
are in [`resource-map.md`](resource-map.md#user-schemas); create, list, and get
exist today (`schema.write` covers create) — `PATCH`/`DELETE /schemas/{id}` are
not yet exposed.

| Permission | Endpoints | Notes |
|---|---|---|
| `schema.read` | `GET /schemas`, `GET /schemas/{id}` | Get + list; list is project-scoped. |
| `schema.write` | `POST /schemas`, `PATCH /schemas/{id}` | Create + manage. `POST /schemas` exists (OpenAPI `schema.write`); `PATCH` **not yet exposed**. |
| `schema.delete` | `DELETE /schemas/{id}` | **Not yet exposed** — target shape. |

### Flow definitions

> **Verb model:** manage — `write` = create + manage; `delete` separate (already in OpenAPI).

| Permission | Endpoints | Notes |
|---|---|---|
| `flow_definition.read` | `GET /flow-definitions`, `GET /flow-definitions/{id}` | Includes validate, simulate (read-only probes). |
| `flow_definition.write` | `POST /flow-definitions`, `PATCH /flow-definitions/{id}`, `POST …/activate`, `POST …/archive` | Create + manage + lifecycle. |
| `flow_definition.delete` | `DELETE /flow-definitions/{id}` | |

### Sessions

> **Verb model:** runtime — app-plane mutations vs operator admin. **`session.write`**
> covers both anonymous shell creation and handoff exchange (OpenAPI:
> `sessions.write` on both). **`session.read`** / **`session.delete`** are
> operator management (list/get/revoke).
>
> **Held by:** runtime-plane `session.write` belongs to the first-party app /
> flow-engine backend (`sk_proj_`), **not** admin bundles, `sk_team_`, or browser
> nonces. Operator `session.read` / `session.delete` are the admin/bundle grants.

| Permission | Endpoints | Notes |
|---|---|---|
| `session.read` | `GET /sessions`, `GET /sessions/{id}` | Operator list + get. |
| `session.write` | `POST /sessions`, `POST /sessions/exchange` | App plane: optional anonymous shell; handoff exchange (create or upgrade authenticated session). |
| `session.delete` | `DELETE /sessions/{id}` | Operator revoke. |

### Auth attempts

> **Verb model:** runtime — `auth_attempt.write` covers start + all mutations
> (OpenAPI: `auth_attempts.write`). No `auth_attempt.create`.
>
> **Held by:** `auth_attempt.write` belongs to the first-party app / flow-engine
> backend (`sk_proj_`) or is nonce-gated in the auth flow — **not** admin
> bundles or `sk_team_`. `auth_attempt.read` is the operator/debug grant.

| Permission | Endpoints | Notes |
|---|---|---|
| `auth_attempt.read` | `GET /auth_attempts/{id}` | Operator/debug read. |
| `auth_attempt.write` | `POST /auth_attempts`, `POST …/challenges`, `POST …/verify`, `POST …/handoff` | App plane. Session materialization is `session.write` (`POST /sessions/exchange`). |

### Events and audit

> **Verb model:** read-only.

| Permission | Endpoints | Notes |
|---|---|---|
| `event.read` | `GET /events/{id}`, `GET /events` | **Identity / auth lifecycle** events (sign-in, password change, factor changes). Not admin config audit — see `audit_event.read`. |
| `audit_event.read` | `GET /audit_events/{id}`, `GET /audit_events` | Configuration and admin changes (who changed what in the console/API). |

### Imports

> **Verb model:** job-lifecycle — `create` + `read` only.

| Permission | Endpoints | Notes |
|---|---|---|
| `import.create` | `POST /imports` | |
| `import.read` | `GET /imports/{id}`, `GET /imports/{id}/errors` | |

---

## Nested name replacements

Old design/credential docs nested parent or scope into the permission name.
Replacements:

| Old name | Replacement | Still accurate? |
|---|---|---|
| `team.users.read` | `user.read` | **Yes.** Nesting only encoded “users in this team”; where stays on the grant/`sk_team_` boundary. Users are a flat resource (`/users`), not a team nested path. |
| `team.users.write` | `user.write` (and usually `user.create` / `user.delete` as needed) | **Yes.** Same flattening; create/delete should be granted explicitly when needed. |
| `team.memberships.read` / `.write` | `team_membership.read` / `team_membership.write` | **Yes.** Compound type, not dot nesting. |
| `team.roles.assign` | `team_membership.write` | **Yes.** Role assignment is a membership mutation. |
| `team.events.read` | `event.read` | **Yes.** Filter to the team via grant/credential scope. |
| `team.scim.sync` | TBD (`scim.sync` or similar) | **Parked** — SCIM interop exists (`/scim/v2/*` in resource-map); no management-permission mapping yet. |
| `allowed_origins.write`, `signing_keys.*` | `allowed_origin.write`, `signing_key.*` | **Yes.** Flat resource permissions; the project grant carries scope. |
| `apps.write` / `idps.write` | `app.write` / `idp.write` | **Yes.** Plural → singular. |
| `projects.settings.write` | `project.write` | **Yes.** No separate “settings” resource. |

---

## Default bundles

Bundles are optional RBAC-style convenience aliases. They are not required —
grants can reference individual permissions directly.

### `project_admin`

Full control over a project and its project-scoped resources.

```
project.create, project.read, project.write, project.delete,
branding.read, branding.write,
domain.read, domain.write, domain.delete,
feature.read, feature.write,
allowed_origin.read, allowed_origin.write, allowed_origin.delete,
signing_key.create, signing_key.read, signing_key.delete,
webhook.read, webhook.write, webhook.delete,
team.create, team.read, team.write, team.delete,
user.create, user.read, user.write, user.set_password, user.delete,
team_membership.create, team_membership.read, team_membership.write, team_membership.delete,
api_key.create, api_key.read, api_key.delete, api_key.rotate, api_key.revoke,
app.read, app.write, app.delete,
idp.read, idp.write, idp.delete,
app_group.read, app_group.write, app_group.delete,
grant.create, grant.read, grant.write, grant.delete,
schema.read, schema.write, schema.delete,
flow_definition.read, flow_definition.write, flow_definition.delete,
session.read, session.delete,
auth_attempt.read,
event.read, audit_event.read,
import.create, import.read
```

> Runtime-plane **`*.write`** (`session.write`, `auth_attempt.write`) are **not**
> included: app-plane / nonce-gated auth-flow operations, not admin provisioning
> grants (see [Create vs write](#create-vs-write) → *runtime*, and the
> origin-bound browser nonce below). Operator reads/revokes stay:
> `session.read`, `session.delete`, `auth_attempt.read`.

### `project_viewer`

Read-only access to all project resources.

```
project.read,
branding.read,
domain.read,
feature.read,
allowed_origin.read,
signing_key.read,
webhook.read,
team.read,
user.read,
team_membership.read,
api_key.read,
app.read,
idp.read,
app_group.read,
grant.read,
schema.read,
flow_definition.read,
session.read,
auth_attempt.read,
event.read, audit_event.read,
import.read
```

### `team_admin`

Manage a team's own resources (scoped to the team grant boundary). Illustrates
[provisioning-boundary](#create-vs-write) splits: includes `team.write` but
**not** `team.create`; full `team_membership.*` and user CRUD including
`user.set_password`.

```
team.read, team.write,
user.create, user.read, user.write, user.set_password, user.delete,
team_membership.create, team_membership.read, team_membership.write, team_membership.delete,
api_key.create, api_key.read, api_key.delete, api_key.rotate, api_key.revoke,
event.read
```

### `team_member`

Basic team-scoped access.

```
team.read,
user.read,
team_membership.read,
event.read
```

---

## Credential-class constraints

Permission grants are further constrained by credential class. The resolver
enforces these before evaluating grants.

### `sk_proj_…`

May hold any system permission within the granted project scope.

### `sk_team_…` — LOCKED

Hard allowlist (see [`credentials.md`](credentials.md#sk_team_-narrow-permission-model--locked)).
Anything not listed under **MAY** is denied; **MUST NEVER** emphasizes
high-risk names (not a second allow path).

```
MAY:
  user.read, user.write              (within this team only; profile edits only,
                                      NOT user.set_password)
  team_membership.read, team_membership.write
                                     (not .create / .delete — roster changes
                                      are human/owner operations; see Invitations)
  api_key.create, api_key.read, api_key.delete, api_key.rotate, api_key.revoke
                                     (within this team only)
  event.read                         (filtered to this team)

MUST NEVER:
  user.set_password                  (account takeover — human/owner op only)
  project.*
  branding.*
  domain.*
  feature.*
  allowed_origin.*
  signing_key.*
  webhook.*
  team.*
  billing.*
  idp.*
  app.*
  app_group.*
  grant.*
  schema.*
  flow_definition.*
  session.*
  auth_attempt.*
  audit_event.read
  import.*
  platform.*                         (cross-project — note: the platform itself is a project)
```

### Origin-bound browser nonce

Only the operations the nonce was minted for. No system catalog permissions
are grantable — browser nonces gate auth flow operations, not management.

---

## Drift notes

This catalog is the **target** permission model. OpenAPI and some design docs
still reflect an older shape. [`authz.md`](authz.md) and
[`credentials.md`](credentials.md) are aligned with this catalog; the gaps
below are follow-up work (issue #420, OpenAPI alignment).

**Verb model.** OpenAPI scopes for several resources use only `.read` and
`.write`, where `.write` means “create and manage.” This catalog keeps that
model for **manage** resources (`app`, `idp`, `app_group`, `schema`,
`flow_definition`, `branding`, `domain`, `allowed_origin`, `webhook`) — no
separate `.create` — and splits `create` from `write` only on
[provisioning-boundary](#create-vs-write) resources (`user`, `team`, `project`,
`team_membership`) plus `grant`. The verb-model follow-up's net-new scopes are
therefore `*.create` / `*.delete` on that provisioning set (not on `schema`,
which stays `schema.read` / `schema.write`). `signing_key` independently uses
action verbs for its create/activate/delete lifecycle. That delta is smaller
than a full-CRUD-everywhere model. `user.set_password` also splits
credential-tier ops out of `user.write`:
`PUT /users/{id}/password` is `user.write` in OpenAPI today and would move to
`user.set_password`.

**Project-scoped configuration.** OpenAPI already declares and uses
`branding.read` / `branding.write`. The current authorization compatibility
layer also lets legacy `project.write` reach branding; the target catalog does
not define that implication. `domain.*`, `feature.*`, `allowed_origin.*`,
`signing_key.*`, and `webhook.*` are target names for planned resources and are
not declared in OpenAPI yet.

**Undeclared resource types.** Many other catalog resources have no OpenAPI scope
entries yet (e.g. `grant`, `api_key`, `team_membership`, `billing`). `/schemas`
now appears in [`resource-map.md`](resource-map.md#user-schemas) but exposes only
create/list/get — `schema.write` / `schema.delete` have no `PATCH`/`DELETE`
endpoint yet.

### Naming renames (OpenAPI → catalog)

| Current name | Location | Proposed name | Issue |
|---|---|---|---|
| `flow_definitions.read` | `oauth2.yaml` | `flow_definition.read` | Plural → singular |
| `flow_definitions.write` | `oauth2.yaml` | `flow_definition.write` | Plural → singular |
| `flow_definitions.delete` | `oauth2.yaml` | `flow_definition.delete` | Plural → singular |
| `sessions.read` | `oauth2.yaml` endpoint | `session.read` | Plural → singular (already mixed: `session.read` on `by_id`, `sessions.read` on collection) |
| `sessions.write` | `oauth2.yaml` endpoint | `session.write` | Plural → singular; covers `POST /sessions` (anonymous shell) and `POST /sessions/exchange`. |
| `auth_attempts.read` | endpoint | `auth_attempt.read` | Plural → singular |
| `auth_attempts.write` | endpoint | `auth_attempt.write` | Plural → singular; covers `POST /auth_attempts` and challenge/handoff mutations |

**Endpoint ↔ scope mismatches** (same follow-up): `session.*` and
`auth_attempt.*` scopes are referenced by endpoints but not declared in
`oauth2.yaml`. Catalog aligns exchange with OpenAPI (`session.write`, not
`auth_attempt.write`).

---

## Open questions

1. **Directory vs PII for users** — deferred. A future `user.list` (roster /
   non-PII) vs `user.read` (full detail) split is attractive for B2B
   directories; not in this draft. Until then `user.read` covers get + list.
2. **SCIM sync** — former `team.scim.sync`. SCIM is a hosted interop surface
   (`/scim/v2/Users`, `/scim/v2/Groups` in resource-map) with no
   **management-permission** mapping yet. Park until `scim.sync` (or similar) is
   defined.
3. **Project configuration endpoint shapes** — permission names are locked
   independently from `project.*`; exact REST operations for domains, features,
   allowed origins, signing keys, and webhooks still need specification.
4. **`app_group` product decomposition** — flagged OPEN in resource-map.md.
   Catalog names may change if app_groups are restructured.
5. **`schema.*` vs `user_schema.*`** — only user schemas exist today; URL is
   `/schemas`. Rename permission prefix if a second schema kind appears.
6. **Billing** — `billing.read` / `billing.write` reserved for platform-project
   teams; endpoints not specified yet (see [Billing](#billing-platform-project--explicit-not-folded)).
7. **Invitations** — folded into `team_membership.create` / `.delete` for MVP;
   promote to `invitation.*` if invite-without-membership-admin is needed.
8. **Project creation gating across deployments** — `POST /projects` is
   anonymous bootstrap + claim in cloud (self-service signup, `security: []`),
   but authenticated `project.create` with no claim on-prem / when an admin
   provisions an additional project. [`hierarchy.md`](hierarchy.md#self-hosted-exposes-the-same-api-shape-as-cloud)
   LOCKs "same API shape, SDK does not branch on deployment mode" and
   anticipates self-hosted growing to multiple projects. Resolve how one
   endpoint applies `project.create` when a credential is present vs allows the
   anonymous path — e.g. contextual auth (credential ⇒ enforce `project.create`;
   anonymous ⇒ unclaimed project), or a uniform bootstrap where claim is
   auto-completed on-prem. Ties to the reserved-vs-real status of
   `project.create`.

## See also

- [`authz.md`](authz.md) — the permission-check invariant
- [`credentials.md`](credentials.md) — credential classes and `sk_team_` allowlist
- [`resource-map.md`](resource-map.md) — endpoint surface
- [ADR 032](../../adrs/032-permission-catalogs.md) — shared catalog architecture
- [ADR 033](../../adrs/033-internal-permission-management.md) — system catalog decision
