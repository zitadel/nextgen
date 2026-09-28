# ADR 024: User, Team, and Lifecycle Ownership

> **Status:** Accepted
> **Date:** 2026-06-11
> **Context:** Project/team/user hierarchy, lifecycle ownership, deletion behavior
>
> **Amendment (2026-08-26):** the user endpoints' `team_id` query parameter is
> **membership**, never lifecycle ownership. On `POST /users` it adds the new
> user to that team; on `GET /users/{user_id}` it serves the user only when
> they hold an active membership there. `team_id` stays the team parameter
> across the API — the distinction is carried by each endpoint's own
> documentation rather than by a longer name, so the parameter reads the same
> everywhere and what it does stays the resource's own business.
>
> That works because the plain name is reserved for one relation. A resource
> takes `team_id` only where membership is its natural relation to a team; a
> resource with no membership relation does not take `team_id` at all, and
> names the relation it actually has. `metadata.lifecycle_owner_team_id` is
> that rule already applied on the user itself, and a session — which has no
> membership relation — takes no plain `team_id` either, whatever its
> team-scoped filter ends up being called.
>
> Lifecycle ownership has no write path today: reads report it as
> `metadata.lifecycle_owner_team_id`, and no endpoint sets it. That is the
> current state of the implementation, not a decision that it should stay that
> way. Team-admin onboarding needs exactly that write path, and the shape it
> takes is for the team-semantics use-case matrix to settle — this amendment
> does not pre-empt it.

## Context

The API hierarchy uses three core resources: projects, teams, and users.
Projects own the identity namespace. Teams are tenant groupings inside a
project.

That model still leaves important lifecycle questions ambiguous: if a team is
deleted, are its users deleted too? If a team-owned user creates another team,
does deleting the owning team also delete the new team? If Fine-Grained
Authorization (FGA) grants a user an `owner` role, does that make the team own
the user's identity lifecycle?

Those are different concerns. Conflating them makes database constraints look
like product semantics and makes `ON DELETE CASCADE` appear to answer questions
that must be answered by explicit lifecycle policy.

## Decision

Users are **project-scoped identities**. A user does not live inside a team.

Teams are **collaboration, data, and lifecycle boundaries**. A team can own
workspace data, customer-tenant state, billing, team-scoped keys, team rosters,
and, when policy says so, the lifecycle of managed users.

Team participation is **not lifecycle ownership**. It can be represented by a
team roster/membership resource, by FGA tuples, or by both. Whatever storage
shape implements team presence, it does not decide who owns the user's
lifecycle.

FGA is the **authorization decision layer**. It answers whether a principal can
perform an action on a resource by evaluating memberships, grants, roles,
credential class, and resolved resource scope. FGA does not decide whether a
user identity should be deprovisioned or purged.

Every user has exactly one lifecycle owner inside the project:

| Lifecycle owner | Meaning | Typical source |
|---|---|---|
| `self` | The user owns its own lifecycle inside the project and may have zero or many team memberships. | Self-serve signup, user-created workspaces. |
| `team` | The user's lifecycle is managed by a specific team. Removing that team or its lifecycle-owner relationship can deactivate the user according to policy. | Enterprise invite, JIT provisioning, SCIM-style tenant management. |

The default for self-serve/default signup is `self`. Product surfaces may
auto-create a default personal team/workspace for that user so the UI and API
can always start in a team context. That personal team is a normal team
resource, not the user's lifecycle owner.

A team-owned user can create or administer another team, but that does not make
the new team a child of the user's lifecycle owner. It creates a team resource
and a participation/authorization relationship such as `owner`.

Lifecycle ownership is not transitive. Deleting or deprovisioning a user
deactivates that user and removes their memberships/access. It does not delete
teams, projects, apps, or other resources the user created or administered.
Those resources must have their own owner/team policy, transfer flow, or
orphaned/needs-owner state.

External systems are modeled as provisioning authorities, not lifecycle owners.
An upstream IdP or directory can be authoritative for attributes or provisioning
events, but the local Zitadel user is still either self-owned or team-owned:
project-wide SSO normally creates self-owned users; enterprise directory/SCIM
provisioning for one customer tenant normally creates team-owned users.

## Lifecycle Matrix

`DELETE` is a lifecycle operation. It deactivates/tombstones first. Hard purge is
governed by retention, audit, and recovery policy and is not implied by the HTTP
verb.

| Operation | Canonical behavior |
|---|---|
| Delete team | Deactivate/tombstone the team, revoke team-scoped API keys, and remove team access/roster state. Preserve self-owned users. Deactivate users lifecycle-owned by that team according to policy. Preserve or transfer resources only where a resource-specific policy says so. |
| Delete user | Deactivate/tombstone the user, revoke sessions, tokens, and credentials, and remove team access. Preserve teams and resources the user created/administered unless an explicit resource-specific cleanup policy applies. |
| Remove user from team | Remove access to that team. Do not delete the user unless that team is the configured lifecycle owner and policy calls for deprovisioning. |

The user's lifecycle status is separate from team-presence state. A user can be
`active`, `suspended`, `deactivated`, or `pending_purge` regardless of whether a
given team roster entry is pending, active, inactive, or removed.

## Consequences

- The database model must not infer identity lifecycle from role names. A user
  can be an `owner` member of a team while remaining self-owned.
- Team-scoped uniqueness and team-scoped access still exist, but they are not
  proof that the team owns the user identity.
- External IdPs and directories do not become a third lifecycle-owner target in
  the database. They are source/provisioning metadata attached to a local
  self-owned or team-owned user.
- Team/resource ownership is not inherited from the creator's lifecycle owner.
  A user owned by Team A can create Team B; deprovisioning the user through Team
  A removes that user's access to Team B but does not delete Team B.
- Current or transitional storage artifacts such as `users.team_id` or
  team-to-user `ON DELETE CASCADE` constraints are not canonical lifecycle
  semantics. Schema follow-up should align storage with this ADR instead of
  treating those constraints as product intent.
- Deletion handlers should execute lifecycle services/policies rather than
  relying on raw SQL cascades for managed resources.
- FGA checks remain necessary before lifecycle mutations, but lifecycle policy
  determines the mutation's effects after authorization succeeds.

## Non-goals

- This ADR does not define the final HTTP request/response schema for lifecycle
  policies.
- This ADR does not implement the database migration away from transitional
  user/team coupling.
- This ADR does not define retention windows or audit-log purge policy.
