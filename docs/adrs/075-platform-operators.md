# ADR 075: Platform Operators

> **Status:** Proposed
> **Date:** 2026-10-22
> **Context:** Who may act on every project of a deployment, and how that
> authority is stored, resolved, issued and shown to customers. This is the
> deployment-wide operator relation that
> [ADR 053 §9](053-cross-project-principals.md#9-deployment-wide-operators-are-a-separate-authority)
> leaves room for, and the staff half of
> [#333](https://github.com/zitadel/nextgen/issues/333). Builds on
> [ADR 032](032-permission-catalogs.md),
> [ADR 033](033-internal-permission-management.md),
> [ADR 053](053-cross-project-principals.md) and
> [ADR 054](054-customer-collaboration-grants.md).
> **Amends if accepted:**
> [ADR 054 §10](054-customer-collaboration-grants.md#10-customer-authority-and-staff-authority-remain-separate),
> whose time-bounded grant branch for staff does not apply to the operator
> relation: operator access is standing until a narrower support tier exists.

## Context

Every authorization path today starts from an assignment on the protected
project. That is right for customers, agencies and consultants. It leaves the
people who run a deployment no way into a project nobody granted them: the
admin of a preview cloud, or support staff helping a customer.

ADR 053 §9 rules out the shortcuts. A role on the platform project, a
`project:*` wildcard and a platform key with broad roles must never stand in
for deployment-wide authority, because customer accounts live in the platform
project. It leaves room for "an explicit deployment-wide operator relation"
whose issuance, visibility and audit are decided separately. ADR 054 §10 adds
that customer authority never implies operator authority and that the Console
derives operator capability on its own. This ADR is that relation.

## Decision

### 1. One platform object, one relation

```text
type platform
  relations
    define operator: [user]

type project
  relations
    define platform: [platform]
    define admin: [user, team#member] or member from team or operator from platform
```

A deployment has one `platform` object above all of its projects. An
operator administers every project and, through the existing closure, edits
and views every project. There is no second tier: a read-only support tier
waits for a support workflow that needs it.

`project.platform` holds no rows. Every project belongs to the deployment's
one platform object, so the resolver reads that tupleset as implied instead
of writing a row per project. The relation is still declared, so the catalog
reads as ordinary OpenFGA and the mapping from `operator` to `project.admin`
is catalog data, not code. The additions are new rows in `cat_sys_1`; no
existing relation's closure changes.

### 2. Operator assignments live in the platform project

An operator is an ordinary `authz_assignments` row in the deployment's
platform project: `object_type = platform`, `relation = operator`,
`scope_kind = project` and a `user` principal. No table changes.

- **Users only.** If a team could hold the relation, whoever manages that
  team's roster in the platform project could make operators, which is the
  escalation ADR 053 §9 forbids. Every dialect refuses any other principal or
  scope for a `platform` assignment.
- **Standing.** Assignments carry no expiry. `expires_at` stays available for
  time-boxed grants later.
- **Out of reach of the grants API.** Managed grants are
  `project.viewer|editor|admin` only, so no customer, and no administrator of
  the platform project, can create, read or revoke an operator assignment
  through it.

The row sits in the platform project rather than beside the resources it
protects, as ADR 033 §2 asks of authorization facts. Like ADR 053 §2's
principal validation, every operator check therefore reads across that
boundary. This is accepted for v1 and revisited with regional data placement.

### 3. Resolution

`Check` evaluates the protected project's grants first. If they do not allow,
and the caller is a user homed in the deployment's platform project, it
evaluates the operator path, which allows when all of these hold:

1. the active catalog has a `tuple_to_userset` edge whose tupleset is the
   checked type's `platform` relation, whose source is a `platform` relation,
   and whose own relation closes to the requested one;
2. an active, unexpired assignment in the platform project names the user
   directly, with a relation that closes to that source; and
3. the user is `active` in the platform project.

The third condition is the home-project status check
[#1234](https://github.com/zitadel/nextgen/issues/1234) asks for, applied here
first because this is the widest authority there is. Deactivating an operator
ends their access on their next request, even though their session survives
(#553).

Project secrets, team principals and users homed in any other project never
reach the operator path. The platform project is configuration: the
bootstrapped one (`platform.bootstrap_project`), or the `platform.project_id`
pin that ADR 053 §2 lets stand in as the platform home for a standalone
deployment. A deployment with neither has no operators.

An operator's `Check` on a project is a project-wide `Allow`, so management
lists skip the list predicate. The predicate's constant arms include the same
operator test, so a materialized list cannot disagree with `Check` either.
The path that allowed is reported with the decision, for §5.

### 4. Issuance is deployment configuration

`platform.operators` lists the user ids that hold the relation. The server
reconciles it at startup:

- It grants every listed user who exists in the platform project, and warns
  about listed ids that do not.
- It revokes the operator assignments it granted earlier
  (`grantor_type = config`) for users no longer listed. Removing a name is
  how operator access is withdrawn, at the next start.
- Both write the ordinary `authz.granted` and `authz.revoked` events in the
  platform project.

Whoever controls a deployment's configuration already controls its data, so
configuration is the root of trust. There is no API to become an operator.

The hosted cloud's launcher defaults the setting to its bootstrap admin, so
every cloud deployment, previews included, has an operator from its first
start.

### 5. Customers see operator writes

Every event emitted for a request the operator path authorized carries this in
`metadata`, in the shape ADR 053 §8 reserved:

```json
{ "authorization": { "path": "platform_operator", "actor_home_project_id": "proj_platform" } }
```

Mutations land in the protected project's own event stream, as they do for
any actor, so a customer can tell an operator's change from their own team's.
The request's `request.api` event lands in the operator's home project and
carries the same block. Operator reads are not yet recorded in the customer's
stream.

### 6. Discovery is access-based enumeration

`listMyProjects` lists the projects a user can act on. For an operator, that is
every project of the deployment, listed in the same order and with the same
paging as anyone's. ADR 053 §6 already puts every path of the active catalog
into that set, and `operator from platform` is one of them.

Operators therefore get no listing, label or Console view of their own: the
Console shows what a person can access, however they reach it. Nothing in it
depends on knowing who is an operator, so there is no capability read either;
ADR 054 §10's rule applies once an operator-only surface exists. An operator
lives with the size of their list as any account with many projects does, and
server-side search on `listMyProjects` is the shared answer.

### 7. Self-hosted

The mechanism is the same everywhere, with no deployment-mode branch. A
self-hosted deployment gets the same platform-above-projects hierarchy once it
has a platform project and names an operator. With neither, nothing changes.

## Consequences

### Positive

- Cloud admins and support staff reach and list every project without a
  grant per project, and without widening what the platform project's own
  roles mean.
- Every management handler gains the operator path through the one gate they
  share, with no change per handler.
- Customers can see in their events when an operator changed something.

### Negative / Risks

- An operator is a full administrator everywhere. There is no narrower tier.
- Standing staff access to customer end-user data needs DPA coverage.
- Every operator check reads the platform project, across any future data
  partition.
- Withdrawing an operator takes effect at the next start, not immediately.

## Rejected alternatives

### A grant per project for a staff team

One row in every project, backfilled and kept in step with every way a
project is created. Each customer's administrators could revoke it, and
whoever manages the team's roster would become an operator issuer.

### Administrators of the platform project are operators

Rejected by ADR 053 §9 and ADR 054: customer accounts live in the platform
project.

### Naming operators by email in configuration

Whoever first registers a configured address would become an operator.

### A separate listing and a capability read for operators

An operator-only search over every project, and an endpoint telling the
Console who is an operator, would make operators a special case of the
question every user asks: which projects can I act on. The hierarchy already
answers it.

### Folding the operator path into `CheckAuthz`

It would save the second query that only an operator's denied grants pay. But
it changes the statement every check and list test drives, and §5 needs the
two answers apart anyway.

## Non-goals

- A read-only support tier, time-boxed grants, or a reason per grant.
- An API or CLI for granting operator access.
- Customer consent or opt-out. An explicit per-project link row is the
  upgrade path if one is decided.
- Recording operator reads in the customer's events, a live "operator access
  active" indicator, or alerting on operator use.
- Impersonation.

## Documentation impact

- ADR 033's Follow-up 5, ADR 053 §9 and ADR 054 §10 point here for operator
  authority.
- [`system-permission-catalog.md`](../design/api/system-permission-catalog.md)
  defines `platform.operator`, and
  [`events-catalog.md`](../design/api/events-catalog.md) lists the startup
  reconcile as a producer of `authz.granted` and `authz.revoked`.
- [`permission-storage.md`](../design/api/permission-storage.md)'s "Left open
  for #333" list points here for operators.
- The [configuration reference](../quick-start/configuration.md) and the
  [cloud runbook](../runbooks/cloud.md) document `platform.operators`.
