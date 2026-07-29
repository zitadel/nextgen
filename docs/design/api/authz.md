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

Permission is denied before any resource content is fetched. Enumeration oracles are closed: failures return 404, not 403.

## Principal types

| Principal | Identifier | Scope semantics |
|---|---|---|
| **user** (user token) | `user_id` | Resolved against `team_memberships` and project grants for the project the user lives in. |
| **`sk_proj_…`** (claimed) | `project_id`, `team_id` (owning team) | Project-wide. |
| **`sk_proj_…`** (pre-claim) | `project_id`, `pre_claim: true` | Project-wide against an unclaimed project. |
| **`sk_proj_…`** (origin-scoped) | `project_id`, `origin_patterns` | Project-wide, gated on request `Origin` matching a pattern. |
| **`sk_team_…`** | `project_id`, `team_id` | Narrow allowlist — see [§ sk_team_ narrow model](#sk_team_-narrow-model). |
| **origin-bound browser** | `project_id`, `origin`, nonce | Only the operations the nonce was minted for. |

A user can be in the platform project (a developer/admin) or a customer project (an end-user); the scope semantics are identical — the project context is what differs.

## Permission resolution

Permissions are flat `{resource}.{verb}` strings such as `user.read`, `project.write`, and `team_membership.write`. Multi-word resource types use `_` (for example `team_membership`, `flow_definition`), not dot nesting. Scope (which project or team) comes from the resolved grant, not from nesting in the permission name. Parent-resource permissions do not inherit into separately cataloged resources: for example, `project.write` does not imply `branding.write`, `allowed_origin.write`, or `webhook.write`. Bundles may grant those permissions together. The resolver answers: "for this principal, in this resolved scope, is this permission granted?" See [`system-permission-catalog.md`](system-permission-catalog.md) for the full list.

> **Not enforced yet.** This is the target model. The server's current compatibility layer (`scopeAllowed` in `internal/api/authz.go`) still treats the legacy operator-grade `project.write` as an umbrella scope that satisfies every finer per-resource scope, including `branding.write`. Per-resource scopes become independently mintable with [ADR 036](../../adrs/036-api-credential-planes.md)'s credential planes; until then, do not assume the stricter model is enforced when configuring clients.

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

- Direct permission grants.
- Role assignments through team_memberships.
- Credential-class allowlists (especially `sk_team_`).
- Resource-scope constraints (`origin_patterns`, project/team boundary, etc.).

Results are cached per request context but never across requests — stale authorisation is a security bug.

## `sk_team_` narrow model

Worth restating here because it's enforced *at the permission-check layer*, not at endpoints. See [`credentials.md`](credentials.md#sk_team_-narrow-permission-model--locked) for the full allow/deny list.

An `sk_team_…` hitting `PATCH /projects/{id}` gets 404 regardless of path. The middleware sees "credential-class = `sk_team_`, required permission = `project.write`" and rejects before the resource-scope index is even consulted. Any other path leads to cross-tenant admin escalation.

## 404 vs 403

Both "ID does not exist" and "authorisation fails" return **404 Not Found**. This closes enumeration oracles. The single exception: operations on resources the caller *already knows exist* (e.g. `PATCH /me`) return 403 when disallowed.

## See also

- [`../glossary.md`](../glossary.md)
- [`credentials.md`](credentials.md) — full principal definitions and the `sk_team_` allowlist
- [`url-architecture.md`](url-architecture.md) — scope resolution that runs before the permission check
- [`resource-map.md`](resource-map.md) — endpoint surface inventory
- [`system-permission-catalog.md`](system-permission-catalog.md) — canonical permission names, bundles, and per-resource permission matrix
