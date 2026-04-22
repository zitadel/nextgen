# Authorization

> The permission-check layer: `credential × resolved scope × required permission → decision`. For vocabulary, [`../glossary.md`](../glossary.md). For scope resolution, [`url-architecture.md`](url-architecture.md).

## The invariant

Every endpoint declares, internally:

```
resource_kind   : users
operation       : read | list | create | update | delete | <verb>
scope_source    : path.id | query.project_id | body.project_id | credential
required_perms  : users.read
```

The middleware executes, in order:

```
1. path.id → resource_scope_index → ctx.project_id / ctx.team_id
2. credential × required_perms × resolved_scope → permission_check
3. DAL query bounded by ctx.*_id (with RLS as backstop)
```

Permission is denied before any resource content is fetched. Enumeration oracles are closed: failures return 404, not 403.

## Principal types

| Principal | Identifier | Scope semantics |
|---|---|---|
| **user** (user token) | `user_id` | Resolved against `team_memberships` and project grants for the project the user lives in. |
| **`sk_proj_…`** (claimed) | `project_id`, `team_id` (owner) | Project-wide. |
| **`sk_proj_…`** (pre-claim) | `project_id`, `pre_claim: true` | Project-wide against an unclaimed project. |
| **`sk_proj_…`** (origin-scoped) | `project_id`, `origin_patterns` | Project-wide, gated on request `Origin` matching a pattern. |
| **`sk_team_…`** | `project_id`, `team_id` | Narrow allowlist — see [§ sk_team_ narrow model](#sk_team_-narrow-model). |
| **origin-bound browser** | `project_id`, `origin`, nonce | Only the operations the nonce was minted for. |

A user can be in the platform project (a developer/admin) or a customer project (an end-user); the scope semantics are identical — the project context is what differs.

## Permission resolution

Permissions are dotted strings: `users.read`, `projects.settings.write`, `team.memberships.write`. The resolver answers: "for this principal, in this resolved scope, is this permission granted?"

**Grants and roles** provide the mapping:

- **Grant** — an explicit access record: `user ↔ app` (can access this app), `team ↔ project` (this team has access to this project), `user ↔ role-in-team`.
- **Role** — a named bundle of permissions inside an app_group. A role is assigned to a principal via a grant or a team_membership.

For end-users: token issuance resolves grants and roles, embeds claims/scopes into the OIDC access token, and the customer's app reads the claims locally. For users in the platform project (developers/admins): the permission check runs per request — there is no "token with baked-in claims" path for platform-project operations.

## FGA decision surface

The decision engine answers `can principal P perform action A on resource R?` considering:

- Direct permission grants.
- Role assignments through team_memberships.
- Credential-class allowlists (especially `sk_team_`).
- Resource-scope constraints (`origin_patterns`, project/team boundary, etc.).

Results are cached per request context but never across requests — stale authorisation is a security bug.

## `sk_team_` narrow model

Worth restating here because it's enforced *at the permission-check layer*, not at endpoints. See [`credentials.md`](credentials.md#sk_team_-narrow-permission-model--locked) for the full allow/deny list.

An `sk_team_…` hitting `PATCH /projects/{id}` gets 404 regardless of path. The middleware sees "credential-class = `sk_team_`, required permission = `projects.settings.write`" and rejects before the resource-scope index is even consulted. Any other path leads to cross-tenant admin escalation.

## 404 vs 403

Both "ID does not exist" and "authorisation fails" return **404 Not Found**. This closes enumeration oracles. The single exception: operations on resources the caller *already knows exist* (e.g. `PATCH /me`) return 403 when disallowed.

## See also

- [`../glossary.md`](../glossary.md)
- [`credentials.md`](credentials.md) — full principal definitions and the `sk_team_` allowlist
- [`url-architecture.md`](url-architecture.md) — scope resolution that runs before the permission check
- [`resource-map.md`](resource-map.md) — per-endpoint `required_perms` declarations
