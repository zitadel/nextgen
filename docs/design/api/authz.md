# Authorization

> The permission-check layer: `credential × resolved scope × required permission → decision`. For vocabulary, [`../glossary.md`](../glossary.md). For scope resolution, [`url-architecture.md`](url-architecture.md). For the canonical permission names, [`system-permission-catalog.md`](system-permission-catalog.md).

## The invariant

Every endpoint declares, internally:

```
resource_kind   : user
operation       : read | list | create | update | delete | <verb>
scope_source    : path.id | query.project_id | body.project_id | credential
required_perms  : user.read
```

The middleware executes, in order:

```
1. path.id → resource_scope_index → ctx.project_id / ctx.team_id
2. credential × required_perms × resolved_scope → permission_check
3. Scope-bound DAL query — the repository signature requires a resolved ScopeContext; no code path can query a scoped table without one
```

Permission is denied before any resource content is fetched. Across project
boundaries (no foothold), failures return **404**. Inside a project the
caller already has a foothold in, missing permission returns **403**
([ADR 033](../../adrs/033-internal-permission-management.md); **D10** in
[`permission-storage.md`](permission-storage.md)).

## Principal types

| Principal | Identifier | Scope semantics |
|---|---|---|
| **user** (user token) | `user_id` | FGA membership checks use `authz_membership_edges` (dual-written from `team_memberships`); see D3 in [`permission-storage.md`](permission-storage.md). Roster/`team_memberships` stay lifecycle-adjacent only. |
| **`sk_proj_…`** (claimed) | `project_id`, `team_id` (owning team) | Project-wide. |
| **`sk_proj_…`** (pre-claim) | `project_id`, `pre_claim: true` | Project-wide against an unclaimed project. |
| **`sk_proj_…`** (origin-scoped) | `project_id`, `origin_patterns` | Project-wide, gated on request `Origin` matching a pattern. |
| **`sk_team_…`** | `project_id`, `team_id` | Narrow allowlist — see [§ sk_team_ narrow model](#sk_team_-narrow-model). |
| **origin-bound browser** | `project_id`, `origin`, nonce | Only the operations the nonce was minted for. |

A user can be in the platform project (a developer/admin) or a customer project (an end-user); the scope semantics are identical — the project context is what differs.

## Permission resolution

Permissions are flat `{resource}.{verb}` strings such as `user.read`, `project.write`, and `team_membership.write`. Multi-word resource types use `_` (for example `team_membership`, `flow_definition`), not dot nesting. Scope (which project or team) comes from the resolved grant, not from nesting in the permission name. Parent-resource permissions do not inherit into separately cataloged resources: for example, `project.write` does not imply `branding.write`, `allowed_origin.write`, or `webhook.write`. Bundles may grant those permissions together. The resolver answers: "for this principal, in this resolved scope, is this permission granted?" See [`system-permission-catalog.md`](system-permission-catalog.md) for the full list.

> **MVP enforcement.** Path-id management handlers resolve scope via
> `GetResourceScope` (`resource_scope_index`) **before** `resolver.Check` on
> coarse `project.{viewer,editor,admin}` (seeded system catalog). Create/list
> keep an explicit `project_id` and call Check directly. `CreateProject` seeds
> an `sk_proj` ↔ `project.viewer` assignment so the returned project secret can
> set up the project. The operator-plane ceiling still requires token scope
> `project.write` (preview/`project.read` remains browser-plane). Fine-grained
> `{resource}.{verb}` catalog relations land with #420; until then do not
> assume independently mintable per-resource scopes when configuring clients.

## Scoped Allow

Locked for [#833](https://github.com/zitadel/nextgen/issues/833) / [#834](https://github.com/zitadel/nextgen/issues/834). List SQL already evaluates team- and resource-scoped grant arms. By-id Check uses those arms after an RSI hit; HTTP lists proceed on Forbidden and attach the EXISTS predicate.

| Path | Rule |
| --- | --- |
| **By-id (after RSI hit)** | Allow when a **team-scoped** grant’s `scope_team_id` equals the row’s `RSI.team_id`, **or** a **resource-scoped** grant’s `scope_resource_id` equals the path id, **and** the catalog relation still matches (`viewer` / `editor` / `admin`). |
| **Create** (no RSI row) | Still requires a **project-scoped** Allow. A principal whose only grant is team- or resource-scoped cannot create project-wide resources. |
| **List** | [#834](https://github.com/zitadel/nextgen/issues/834): Forbidden (foothold, no project-wide Allow) proceeds and `withAuthzListFilter` attaches the EXISTS predicate (partial view). NotFound (no foothold) still 404s. |
| **403 vs 404** | Unchanged (**D10**). Scoped Allow is still inside a project foothold. |

Bare `requireProjectAccess` (create / list / project-by-id without an RSI object) must not treat a team-scoped grant as project-wide Allow.

**Grants and roles** provide the mapping:

- **Grant** — an explicit access record: `user ↔ app` (can access this app), `team ↔ project` (this team has access to this project), `user ↔ role-in-team`.
- **Role** — a named bundle of permissions inside an app_group. A role is assigned to a principal via a grant or a team_membership.

For end-users: token issuance resolves grants and roles, embeds claims/scopes into the OIDC access token, and the customer's app reads the claims locally. For users in the platform project (developers/admins): the permission check runs per request — there is no "token with baked-in claims" path for platform-project operations.

## Authorization vs lifecycle ownership

**LOCKED by [ADR 024](../../adrs/024-user-team-lifecycle-ownership.md).**
FGA decides whether a principal may perform an action. It does not decide who
owns a user's identity lifecycle or what deletion/deprovisioning should do after
the action is authorized.

Lifecycle mutations run in two steps:

1. Authorization checks whether the caller can request the mutation in the
   resolved scope.
2. Lifecycle policy decides the mutation's effects: deactivate/tombstone, revoke
   credentials, remove memberships, preserve self-owned users, deactivate users
   lifecycle-owned by the relevant team, or schedule purge.

Roles such as `owner`, `admin`, and `member` are authorization roles. A user can
own/administer a team through a membership role while still being self-owned. A
team only owns a user's lifecycle when explicit project/team/provisioning policy
marks that user as team-owned.

## FGA decision surface

The decision engine answers `can principal P perform action A on resource R?` considering:

- Direct permission grants (`authz_assignments`).
- Team usersets via `authz_membership_edges` and relation closure (see [`permission-storage.md`](permission-storage.md)); `team_memberships` is roster/lifecycle only, not the check fact source.
- Credential-class allowlists (especially `sk_team_`).
- Resource-scope constraints (`origin_patterns`, project/team boundary, etc.).

Results are cached per request context but never across requests — stale authorisation is a security bug.

## `sk_team_` narrow model

Worth restating here because it's enforced *at the permission-check layer*, not at endpoints. See [`credentials.md`](credentials.md#sk_team_-narrow-permission-model--locked) for the full allow/deny list.

An `sk_team_…` hitting `PATCH /projects/{id}` gets 404 regardless of path. The middleware sees "credential-class = `sk_team_`, required permission = `project.write`" and rejects before the resource-scope index is even consulted. Any other path leads to cross-tenant admin escalation.

## 404 vs 403

- **No project foothold** (or unknown resource outside the caller's reach) →
  **404 Not Found**. Closes cross-project enumeration oracles.
- **Foothold in the project, missing required permission** → **403 Forbidden**.
  Actionable for authorized callers ([ADR 033](../../adrs/033-internal-permission-management.md)).
- Self resources the caller already knows exist (e.g. `PATCH /me`) also return
  403 when disallowed.
- **Delete idempotency (operators):** when `path.id` has no RSI row in the
  caller's project scope, operators (`project.write`) get **204 No Content**;
  preview and other callers get the resource readMiss shape (404). This is a
  deliberate tradeoff: operators with any project secret can still distinguish
  fabricated ids from real foreign resources (404/403 after RSI hit). See D10 in
  [`permission-storage.md`](permission-storage.md).

## See also

- [`../glossary.md`](../glossary.md)
- [`credentials.md`](credentials.md) — full principal definitions and the `sk_team_` allowlist
- [`url-architecture.md`](url-architecture.md) — scope resolution that runs before the permission check
- [`resource-map.md`](resource-map.md) — endpoint surface inventory
- [`system-permission-catalog.md`](system-permission-catalog.md) — canonical permission names, bundles, and per-resource permission matrix
- [`permission-storage.md`](permission-storage.md) — Wave 0 relational DDL, dual-write membership edges, and check SQL shape
