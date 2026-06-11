# ADR 022: User, Team, Membership, and Lifecycle Ownership

> **Status:** Accepted
> **Date:** 2026-06-11
> **Context:** Project/team/user hierarchy, membership semantics, deletion behavior

## Context

The API hierarchy uses three core resources: projects, teams, and users.
Projects own the identity namespace. Teams are tenant groupings inside a
project. Memberships attach users to teams and carry roles.

That model still leaves an important lifecycle question ambiguous: if a team is
deleted, are its users deleted too? If a user owns a team, does deleting the
user delete the team? If Fine-Grained Authorization (FGA) grants a user an
`owner` role, does that make the team own the user's identity lifecycle?

Those are different concerns. Conflating them makes database constraints look
like product semantics and makes `ON DELETE CASCADE` appear to answer questions
that must be answered by explicit lifecycle policy.

## Decision

Users are **project-scoped identities**. A user does not live inside a team.

Teams are **collaboration, data, and lifecycle boundaries**. A team can own
workspace data, customer-tenant state, billing, team-scoped keys, memberships,
and, when policy says so, the lifecycle of managed users.

Memberships are **access relationships**. A `team_membership` binds a project
user to a team with status and roles. Roles such as `owner`, `admin`, and
`member` are authorization roles; they do not by themselves decide who owns the
user's lifecycle.

FGA is the **authorization decision layer**. It answers whether a principal can
perform an action on a resource by evaluating memberships, grants, roles,
credential class, and resolved resource scope. FGA does not decide whether a
user identity should be deprovisioned or purged.

User lifecycle ownership is explicit and configurable:

| Lifecycle owner | Meaning | Typical source |
|---|---|---|
| `project` | The user is owned by the project identity namespace and may have zero or many team memberships. | Self-serve signup, user-created workspaces. |
| `team` | The user's lifecycle is managed by a specific team. Removing that team or its lifecycle-owner relationship can deactivate the user according to policy. | Enterprise invite, JIT provisioning, SCIM-style tenant management. |
| `external` | Zitadel enforces local access state, but an upstream system owns the source identity lifecycle. | External IdP, external directory, SCIM where upstream remains authoritative. |

The default for self-serve/default signup is `project`. A user-created team does
not make the team the user's lifecycle owner; it creates a membership with an
authorization role such as `owner`.

## Lifecycle Matrix

`DELETE` is a lifecycle operation. It deactivates/tombstones first. Hard purge is
governed by retention, audit, and recovery policy and is not implied by the HTTP
verb.

| Operation | Canonical behavior |
|---|---|
| Delete team | Deactivate/tombstone the team, revoke team-scoped API keys, and deactivate/remove team memberships. Preserve project-owned users. Deactivate team-owned users according to the team's lifecycle policy. Preserve or transfer resources only where a resource-specific policy says so. |
| Delete user | Deactivate/tombstone the user, revoke sessions, tokens, and credentials, and deactivate memberships. Preserve teams and resources unless an explicit resource-specific cleanup policy applies. |
| Delete membership | Remove access to that team. Do not delete the user unless that membership is the configured lifecycle-owner relationship and policy calls for deprovisioning. |

The status of a user is separate from the status of a membership:

| Resource | Example statuses |
|---|---|
| User | `active`, `suspended`, `deactivated`, `pending_purge` |
| Team membership | `pending`, `active`, `inactive`, `removed` |

## Consequences

- The database model must not infer identity lifecycle from role names. A user
  can be an `owner` member of a team while remaining project-owned.
- Team-scoped uniqueness and team-scoped access still exist, but they are not
  proof that the team owns the user identity.
- Current or transitional storage artifacts such as `users.team_id` or
  team-to-user `ON DELETE CASCADE` constraints are not the canonical N:N
  membership model. Schema follow-up should align storage with this ADR instead
  of treating those constraints as product intent.
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
