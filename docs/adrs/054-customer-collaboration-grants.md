# ADR 054: Customer Collaboration Grants

> **Status:** Proposed
> **Date:** 2026-08-13
> **Context:** How customer teams own projects and grant their platform-project
> users role-appropriate access to selected projects. Builds on
> [ADR 024](024-user-team-lifecycle-ownership.md),
> [ADR 032](032-permission-catalogs.md),
> [ADR 033](033-internal-permission-management.md),
> [ADR 035](035-configuration-environments.md),
> [ADR 046](046-claim-lifecycle-v2.md), and
> [ADR 053](053-cross-project-principals.md).
> **Amends if accepted:** [ADR 046 §4](046-claim-lifecycle-v2.md#4-the-personal-team-is-created-at-registration-not-at-claim)
> so claim selects an explicitly authorized target team instead of always
> reusing the claimer's personal team.

## Context

Zitadel Cloud keeps customer administrators in the reserved platform project.
Paying customer accounts are teams in that project, and each customer may own
several Zitadel projects. A real customer organization needs both broad account
owners and narrower operators:

- Alice owns Acme and administers all Acme projects.
- Bob works only on the AI project.
- A production operations group administers Production but only views
  Sandbox.
- Removing a person from that group must revoke every derived project grant
  immediately.

Granting every platform-project administrator access to every project is not a
customer collaboration model; it is a deployment-wide escalation. Granting
every member of an owning team the same project role is also too broad.

Two established product patterns inform the decision:

- Vercel distinguishes team-wide owners from contributors who have no project
  access until assigned a project role, supports direct project roles for
  individual contributors, and uses access groups to map groups of people to
  roles on selected projects.
  [Vercel access roles](https://vercel.com/docs/rbac/access-roles) and
  [access groups](https://vercel.com/docs/rbac/access-groups).
- GitLab supports direct project members as well as inherited and shared group
  members. When several paths apply, the highest role wins.
  [GitLab project members](https://docs.gitlab.com/user/project/members/) and
  [roles and permissions](https://docs.gitlab.com/user/permissions/).

Zitadel adopts those principles using its existing team, membership, and FGA
assignment resources. It does not copy either product's billing tiers or exact
role catalogue.

## Decision

### 1. Membership and authorization are separate facts

Merely being a user in the platform project grants no customer-project access.
A customer-account relationship begins with active membership in a
platform-project team, but membership alone grants no team-management or
project-management authority.

The v1 facts are deliberately separate:

| Fact            | Stored as                                                                              | Authority                                                                                                                             |
| --------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Participant** | An active `team_memberships` roster row.                                               | None by itself. It records participation, invitation/provisioning state, and billing-seat context.                                    |
| **Team owner**  | A separate `authz_assignments` row granting `team.owner` to a user at that team scope. | Manage that team's roster and ownership grants. When the team owns projects, also receives the account-level authority defined below. |

`team_memberships` remains the roster, invitation, provisioning, and status
source from ADR 024. An active roster mutation still dual-writes its
`authz_membership_edges` member projection under ADR 033. That projection says
only "this user participates in this team"; it produces project authority only
when a protected project separately grants a role to that team userset.
`team.owner` is an independent authorization assignment and does not become a
lifecycle ownership field.

Product mutations keep the distinct facts consistent: a `team.owner` assignment
may be issued only to an active team participant; removing or deactivating that
participant revokes their `team.owner` assignment in the same transaction.
Being an active participant never synthesizes `team.owner`. Ordinary mutations
must leave a team with at least one active owner; only an identity-level
suspension may transiently break that state, and §8 defines what it leaves
behind. Ownership transfer is explicit and resources do not depend on the
lifecycle of their creator.

Creating a team, its creator's active roster membership, and a distinct
`team.owner` assignment for that creator is one transaction. This rule applies
equally to an owning customer team and a team used as an access group.

### 2. Every customer project has one owning team

The target system catalog adds a direct `project.owning_team` relation and a
separate `team.owner` relation. These replace the transitional
`project.team`/`team.member` ownership derivation in the current MVP catalog;
neither target relation exists in the checked-in seed yet. Exactly one active
owning-team assignment may exist per claimed or account-owned project. It is
stored as an `authz_assignments` row on the protected project, with the foreign
platform team as principal.

That uniqueness is enforced, not assumed. The generic active-assignment key
includes the principal, so by itself it permits two teams to hold `owning_team`
concurrently; racing claim or transfer requests must not be able to create that
state. Each dialect provides an equivalent guarantee — a partial or
null-filtered unique index over active `owning_team` rows where the database
supports one, serialization through the single atomic transfer mutation (§8)
where it does not — and an owning-team assignment never carries `expires_at`:
ownership ends by explicit transfer or revocation, never by lapse. The losing
writer of a race receives a conflict, not a second owner.

The owning team determines:

- which customer account the project belongs to;
- which team owners inherit project administration;
- who may issue customer collaboration grants;
- which team may select the project in billing and customer-portal views.

Ownership is not inferred from the user who created or claimed the project, and
it is not stored as a mutable `projects.team_id` shortcut. The unique active
grant remains the source of truth, consistent with ADR 046.

### 3. Team owners inherit; contributors do not

The system catalog derives project administration from the owner relation of
the owning team. Ordinary team membership does not derive viewer, editor, or
administrator access.

An illustrative OpenFGA-profile fragment is:

```text
type user
type sk_proj

type team
  relations
    define owner: [user]
    define member: [user]

type project
  relations
    define owning_team: [team]
    define admin: [user, team#member, sk_proj] or owner from owning_team
    define editor: [user, team#member] or admin
    define viewer: [user, team#member] or editor
```

The fragment is semantic, not a replacement for the canonical system catalog.
`team.member` and `team.owner` remain independent relations. The product
transaction maintains the rule that an owner must also be an active participant
because the current portable OpenFGA profile does not rely on intersection for
that invariant.

The hierarchy direction is normative:

```text
admin -> editor -> viewer
```

Viewer never implies editor or administrator. The current MVP seed closes in
the opposite direction and assigns project secrets to `project.viewer` so that
placeholder closure satisfies administrator checks.

This software is still alpha. Correct the checked-in PostgreSQL, SQLite, and
Spanner seed migrations, constructors, and tests together: a project secret
receives `project.admin`, and `admin` satisfies `editor` and `viewer`. No
compatibility migration or assignment backfill is provided.

That closure applies to a customer project's own `sk_proj_` secret. The
reserved platform project mints no secret by default, and platform-homed
automation has no credential yet — it waits on the deferred PAT / service-user
principal
([ADR 053 §9](053-cross-project-principals.md#9-deployment-wide-operators-are-a-separate-authority)).

Databases that already applied the old Goose migration must be dropped and
recreated: editing an applied migration never updates its catalog, so reuse
would leave the permissive closure active. CI is fresh every run — this note
exists for persistent local databases and alpha operators, and the
implementation handoff must include the exact reset procedure. Never patch an
active catalog partially.

### 4. Direct users and access teams are both v1 sharing primitives

Ordinary teams in the platform project act as v1 access groups. Granting an
access team a project relation gives every active member the selected role on
that project:

```text
team:acme-ai-admins -> project.admin  -> project:acme-ai
team:acme-prod-readers -> project.viewer -> project:acme-production
```

Projects may also grant a role directly to one active platform-project user:

```text
user:bob -> project.admin -> project:acme-ai
```

Direct user assignments match Vercel's individual project roles and GitLab's
direct project members. Team assignments match Vercel access groups and GitLab
group-derived access. Neither form is translated into the other in storage.

The same access team may receive roles on several projects, and a person may
belong to several access teams. This matches the core Cloud shape: Alice owns
Acme and therefore administers all Acme-owned projects; Bob does not inherit
that authority merely because he is an Acme participant. Bob receives selected
access through a direct project grant or through teams such as
`acme-ai-admins` and `acme-prod-readers`, which the protected projects grant
explicit roles.

Owning teams and access teams are two uses of the same existing `team`
resource, not separate resource types. A team may be both an owning team and an
access team, although dedicated access teams usually express narrower intent.
The team's roster and separate owner assignments govern that team; the
protected project governs the role granted to its member userset. Neither side
gains authority over the other resource merely because the project grant
exists.

An agency or consultancy uses its own platform-project team as the principal on
customer-issued grants. A user may belong to several customer or agency access
teams. Team IDs are stable addressing identifiers.

For v1, the customer-facing collaboration API accepts either a user ID or team
ID from the platform project. It validates that the supplied principal exists
and is active without exposing a global directory. Direct grants are useful for
one-off access; access teams are preferred when several people share the same
project set or when one membership removal should revoke several derived roles.

Both primitives are model commitments from day one: the row shape is identical,
and the testing obligations cover the direct and team-derived paths regardless
of when each API surface ships. The collaboration API itself may stage — team
grants can ship first, with direct user grants following once §6's per-project
grant listing and §9's source-annotated project listing are implemented,
because a direct grant is only operable once an owner can enumerate and revoke
it as easily as a membership. Staging is an API-availability choice, not a
model choice; nothing may be built that assumes teams are the only grant
principal type.

Removing a person from an access team revokes only roles derived through that
team; a deliberate direct project grant remains until separately revoked.
Suspending the platform identity denies both direct and team-derived access on
the next check.

No new `access_group` resource, sub-team, or nested team hierarchy is
introduced. A team is the existing userset; `project.owning_team` identifies
its account-ownership use, while an explicit project-role assignment identifies
its access-group use. Access-team lifecycle authorization uses the existing team
contract; this ADR does not give customer owners authority over every team in
the platform project.

### 5. Project roles are additive and monotonic

The v1 project roles are:

| Role              | Intended authority                                                                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Viewer**        | Read project metadata and project resources allowed by the read-only system-catalog bundle.                                                                                                            |
| **Editor**        | Viewer authority plus ordinary project-resource configuration and lifecycle operations, excluding access grants, ownership transfer, project deletion, billing, and other owner/admin-only operations. |
| **Administrator** | Full project administration and grant management, excluding customer-team ownership and billing operations that belong to the owning-team owner.                                                       |

`project.create` is also account/team authority, not authority derived from
administration of an existing project. Creating a sibling project is authorized
against its selected owning team as described in §7.

When several paths apply, the strongest role wins. Owning-team inheritance,
direct user grants, and multiple team grants form a union. A lower project
grant cannot reduce a higher inherited role.

V1 assignments are project-scoped. They do not introduce environment-scoped
collaboration grants. Until ADR 035's deferred environment security model is
defined, any environment operation included in a project role applies to all
environments in that project.

Consequently, an owning-team owner cannot be made viewer-only on one owned
project in v1. Sensitive projects that must exclude an account owner require a
different owning team. Explicit deny, exclusion, and temporary role suppression
are out of scope until a concrete use case justifies expanding the portable FGA
profile.

### 6. Grant mutations are protected-project operations

Project-role grants are ordinary authorization assignments on the protected
project. Creating, changing, listing, and revoking them requires the applicable
`grant.*` permission in that project. The grant records:

- protected project;
- target user or team;
- project role;
- creation time;
- optional expiry; and
- revocation state.

These are the fields already represented by an ordinary `authz_assignments`
row: principal, object/relation, scope, timestamps, expiry, and revocation.
ADR 032/033's `grantor_*` and `delegation_id` fields remain reserved for
delegated agent authority; an ordinary customer collaboration grant is not an
agent delegation.

The owning-team owner receives the authority needed to issue grants through the
ownership relation. A project administrator may manage grants only when the
canonical administrator bundle includes the corresponding `grant.*`
permissions. Grant mutation and audit event emission happen in the same
transaction.

The ADR 048 audit event—not the assignment row—records which authenticated
human created, changed, or revoked the grant and names the assignment ID. This
preserves an immutable history without overloading delegation columns.
Put plainly, the assignment says **who has which project role**; the event says
**who changed that assignment**.

Customer-issued grants need no agency-side request flow in v1. The customer
names the target user or team ID and remains responsible for granting and
revoking access. Invitations, approval handshakes, and a discoverable agency
directory are later product surfaces.

### 7. Project creation and claim name the target team

The caller's current or personal team is a default, not an authorization
boundary. Authenticated project creation and claim accept an explicit target
`team_id`.

The server permits attachment only when:

- the target team is active;
- it lives in the platform project for Cloud customer ownership;
- the authenticated user is an active owner of that team; and
- the project does not already have an owning team, for first claim.

If `team_id` is omitted, the server may use the caller's personal team only when
the caller actively owns that team and the choice is unambiguous. Otherwise the
request must fail with a team-choice error rather than silently attach the
project to an arbitrary membership.

This supersedes ADR 046 section 4's rule that every returning claimer attaches
future projects to their one personal team. It preserves ADR 046's other
decisions: claim is still a single first-claim-wins project-to-team grant, the
claim challenge remains ephemeral, and claim never creates a team or
membership.

Self-hosted uses the same resulting user, membership, authorization-assignment,
and owning-team shape. Its explicit seed/bootstrap path is defined by Console
ADR 0004 rather than by claim: test infrastructure may provision it directly,
and a later server seed file may reconcile the same desired state. Self-hosted
does not need the cloud claim handoff.

### 8. Offboarding and ownership transfer are explicit

Removing a user from a customer or agency team removes every project role
derived through that team on the next authorization check. The project
assignments remain so that other active team members retain access. Direct user
grants are intentionally independent and must be revoked separately; suspending
or deactivating the user denies all paths immediately.

Removing the final owner of an owning team is rejected until another active
owner is assigned. Suspending or deactivating the user who is the final active
owner is **not** rejected: identity-level security actions take effect
immediately and outrank §1's owner-retention invariant. The team is then left
without an active owner, and its owned projects show the derived `needs_owner`
condition below; rejection remains the rule only for ordinary owner removal.
Deactivating an owning team leaves its projects in the same derived
`needs_owner` condition for management purposes; this is not a new persisted
project status. It does not delete projects or create a new owner implicitly.

**Recovery from `needs_owner` is authorized, not deferred.** Ordinarily only an
active owner may issue `team.owner`, so a team with none would otherwise be
permanently stuck — reachable through a single security action, with no exit.
Two paths resolve it, and both are in-project operations that keep §9's
customer/staff boundary intact:

- reinstating the suspended identity restores its existing `team.owner`
  assignment, which is not revoked by suspension; and
- an administrator of the **platform project** — where every owning team is
  homed — may assign `team.owner` to an active participant of an ownerless
  team. This is ordinary administration of a platform-project resource, not
  deployment-wide authority: it confers nothing on the customer projects that
  team owns beyond what the new owner then inherits, and it does not need
  [ADR 053 §9](053-cross-project-principals.md#9-deployment-wide-operators-are-a-separate-authority)'s
  deferred operator credential.

The second path is privileged and applies only while the team has no active
owner; it is never a way to add a co-owner to a healthy team. Both emit the
ordinary ADR 048 grant-mutation event, so recovery is auditable.

An ownership transfer is one atomic mutation that replaces the unique
`owning_team` assignment. The v1 caller must be an active owner of both the
current and target teams. Transfers without one common authorized owner require
a two-party approval flow and are out of scope.

Transfer revokes all explicit user- and access-team-to-project collaboration
assignments on the project by default. A later API may accept an explicit retain
list, but silent retention is unsafe. Project-secret rotation remains governed
separately; this ADR does not claim that replacing the owner invalidates already
issued service credentials.

### 9. Project listing returns effective access and its source

The authorized-project query from ADR 053 returns only projects on which the
principal has an effective role. For each result it may return:

```text
effective_role: viewer | editor | admin
sources:
  - owning_team
  - user:<user_id>
  - team:<team_id>
```

The effective role is the maximum across all active paths. Source information
lets the Console explain why a user has access and where an administrator must
change it. Pagination and filtering happen after the authorization predicate is
composed into the same SQL query, not after fetching an unfiltered page.

### 10. Customer authority and staff authority remain separate

Customer team ownership and customer/agency access-team grants never imply
deployment-wide operator or staff-support authority. Staff support does not
require membership in the customer's owning team and must use its own
time-bounded, audited grant branch.

The Console may render customer management and instance-operator surfaces in
one application, but it derives each capability independently. It must not use
the presence of a platform-project user, platform-team owner, or project
administrator as a proxy for system-operator access.

## Testing obligations

The stable service-backed test matrix must include:

1. Alice owns Acme and is administrator on every Acme-owned project, but no
   Contoso project.
2. Bob is an Acme participant and sees no project before receiving a direct
   grant or joining a granted access team.
3. Direct `project.viewer`, `project.editor`, and `project.admin` grants give
   Bob exactly the corresponding monotonic role on Acme AI and have no effect
   on other projects.
4. Membership in `acme-ai-admins` makes Bob administrator on Acme AI;
   membership in `acme-prod-readers` makes him viewer on Acme Production, with
   no access elsewhere.
5. Direct, team-derived, and owning-team paths produce the highest effective
   role.
6. A lower explicit grant does not reduce owning-team owner authority.
7. Removing Bob from an access team removes every role derived through that
   team but preserves an independent direct grant; suspending Bob denies both.
8. An inactive team or expired/revoked project grant does not authorize.
9. Claim attaches to the explicitly selected owned team and rejects an
   unauthorized or ambiguous target.
10. Project transfer changes inherited owners atomically and revokes prior
    collaboration grants by default.
11. A project secret remains confined to its own project.
12. A customer cannot enumerate platform users or teams while validating a
    supplied principal ID.
13. The self-hosted one-project default produces the same team/project/grant
    representation as Cloud.
14. Owning an access team permits roster management but grants no authority on
    another team or project unless an explicit relation provides it.
15. Active membership without a `team.owner` assignment grants no owner
    authority.
16. The team-owner write path rejects creating a `team.owner` assignment for a
    user without active membership, and membership removal revokes the separate
    owner assignment in the same transaction. The resolver does not re-read
    roster state or add an owner/member intersection on every authorization
    check.
17. Suspending the sole owner of an owning team succeeds, leaves its projects
    in `needs_owner`, and is recoverable both ways: reinstating that identity
    restores its owner authority, and a platform-project administrator can
    assign `team.owner` to another active participant. The same privileged
    assignment is rejected while the team still has an active owner (§8).

## Consequences

### Positive

- Customer owners get a simple account-wide experience across their projects.
- Customer operators receive least-privilege project roles through direct
  grants or independently grantable customer and agency access teams.
- Access-team offboarding or platform-identity suspension is immediate and
  does not require sweeping project assignments.
- The same model supports customers, agencies, consultants, Cloud, and
  self-hosting.
- Multiple projects remain available without making them mandatory for simple
  self-hosted installations.

### Negative / Risks

- Direct grants require explicit lifecycle handling when a person leaves a
  customer but their platform identity remains active.
- Owning-team owners cannot be downgraded on one owned project.
- Ownership transfer must coordinate grant revocation and may temporarily
  require re-granting valid customer or agency teams.
- Customer owners must manage access-team rosters separately from the owning
  customer team's roster because v1 has no nested team hierarchy.
- Team ID exchange for agencies is an out-of-band UX until a safe discovery or
  invitation surface exists.

## Rejected alternatives

### Platform-project admin means administrator of every project

Rejected because customer users live in the platform project. This would turn a
customer role into cross-tenant system authority.

### Every owning-team member inherits project access

Rejected because account membership and project assignment answer different
questions. Contributors need zero default project access; independently granted
access teams express the selected audience.

### Direct per-user grants as the only collaboration model

Rejected because both Vercel and GitLab support individual and group-derived
project access. Direct grants solve one-off access; team usersets solve repeated
assignment and membership-driven offboarding.

### A new access-group resource

Rejected because the existing team and membership resources already provide a
userset. A new resource would duplicate roster and offboarding semantics.

### Explicit deny or per-project owner downgrade

Rejected for v1 because the portable FGA profile and current storage are
additive. Introducing subtraction would complicate check/list equivalence and
make effective access harder to explain.

### Session team as the hard project-creation boundary

Rejected because a user may own several teams. The session team is a default;
authorization on the explicitly selected target team is the boundary.

## Non-goals

- Staff support roles, customer consent for support, break-glass, and
  impersonation.
- Customer-defined custom system roles.
- Agency discovery, invitation acceptance, or reciprocal approval.
- Cross-customer ownership transfer.
- Billing and licensing implementation.
- Project-secret rotation during claim or transfer.
- Environment-specific collaboration grants; v1 project roles apply at project
  scope while ADR 035's environment security model remains deferred.

## Documentation impact

If accepted, follow-up documentation must:

- amend ADR 046 and the claim-flow design so the caller selects an authorized
  target team;
- update [`hierarchy.md`](../design/api/hierarchy.md) with owner versus
  contributor semantics and access-team project grants;
- replace the inverted MVP project-role closure in
  [`system-permission-catalog.md`](../design/api/system-permission-catalog.md)
  and the checked-in alpha seed with the normative
  `admin -> editor -> viewer` hierarchy, assign project secrets to `admin`, and
  keep `project.create` at the owning-team boundary; require dropping and
  recreating databases that applied the old alpha seed rather than promising a
  compatibility migration;
- update [`permission-storage.md`](../design/api/permission-storage.md) with
  separate membership and `team.owner` facts, unique owning-team assignments,
  direct-user grants, transfer/revocation rules, the addition of
  `project.owning_team`, and retirement of the transitional `project.team`
  ownership relation; and
- update the Console/customer-portal contract to use the authorization-filtered
  project query and explain effective-role sources.
