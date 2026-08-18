# ADR 053: Cross-Project Principals

> **Status:** Proposed
> **Date:** 2026-08-13
> **Context:** How a human identity whose account lives in one project is
> authenticated and authorized to act on Zitadel resources protected by another
> project. Builds on [ADR 024](024-user-team-lifecycle-ownership.md),
> [ADR 032](032-permission-catalogs.md),
> [ADR 033](033-internal-permission-management.md), and
> [ADR 036](036-api-credential-planes.md).
> **Amends if accepted:** ADR 036's credential-plane invariant and table so
> operator-plane operations may authenticate either confidential automation or
> a first-party human session;
> [ADR 046 §2](046-claim-lifecycle-v2.md#2-claimcomplete-is-authenticated-by-a-platform-project-session)
> to require explicit CSRF protection for cookie-authenticated mutations; and
> [ADR 048](048-wide-events-internal-audit-primitive.md)'s emit-time rule for
> `team_id`, which today captures the resolved credential's team scope. For a
> foreign actor that rule would store the actor's _home_-project team; §8
> requires the column to carry protected-resource scope only, and moves the
> actor's team to the non-PII `authorization` metadata.
> **Clarifies:** [ADR 046 §1](046-claim-lifecycle-v2.md#1-claim-state-is-a-permission-engine-grant)
> remains the ownership/claim rule; a direct user assignment defined here is an
> access grant and never claim state or project ownership.

## Context

Users are project-scoped identities. A developer who signs in to Zitadel Cloud
is a user in the reserved platform project, while the end-users managed by a
customer project are different identities inside that customer project. This
tenant boundary is intentional and remains unchanged by this ADR.

The Console nevertheless needs to let a platform-project user manage every
customer project that their teams and grants authorize. Agencies, consultants,
and support staff need the same underlying mechanism. Creating a shadow user in
every protected project would make offboarding, recovery, audit, and billing
ambiguous. Treating any role on the platform project as deployment-wide access
would instead make every customer administrator a global Zitadel administrator.

The permission foundation already anticipates the correct shape:

- [ADR 033](033-internal-permission-management.md) resolves authorization from
  assignments, relation closure, membership edges, and resource scope.
- [`permission-storage.md` D13](../design/api/permission-storage.md#locked-decisions)
  stores a foreign user or team assignment on the **protected** project.
- `authz_membership_edges` remains in the principal's **home** project and is
  not copied into every protected project.
- The resolver already distinguishes the target project from
  `principal_home_project_id`, but the HTTP management gate still assumes they
  are equal.

This ADR ratifies the cross-project mechanism and its security boundary. It does
not define customer collaboration policy; [ADR 054](054-customer-collaboration-grants.md)
does that. Together they resolve the cross-project human-identity question that
[ADR 033](033-internal-permission-management.md) (out of scope) and
`permission-storage.md` both deferred to
[#333](https://github.com/zitadel/nextgen/issues/333). The remainder of #333 —
staff support tiers, customer consent, and break-glass governance — stays open
as separate follow-up decisions (§9).

## Glossary

| Term                  | Meaning                                                                                                                                                      |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Home project**      | The project that owns the authenticated user identity and its team memberships. For Cloud customer administrators this is the platform project.              |
| **Protected project** | The project whose resources and authorization rows are being accessed. It may differ from the principal's home project.                                      |
| **Foreign principal** | A user or team whose home project differs from the protected project named by an authorization assignment.                                                   |
| **Foothold**          | At least one active authorization path into the protected project. A principal without a foothold must not learn whether resources inside the project exist. |

## Decision

### 1. Cross-project access uses foreign principals, not global identities

A cross-project actor remains the same project-scoped user from
[ADR 024](024-user-team-lifecycle-ownership.md). Zitadel does not create a
second user in the protected project and does not introduce a global user row.

The server-authoritative principal context is:

```text
principal_type
principal_id
principal_home_project_id
target_project_id
credential_class
```

`principal_home_project_id` comes from credential resolution. It is never
accepted from a request body, query parameter, or browser-controlled header.
The target project comes from the requested resource, request scope, or
`resource_scope_index`.

A foreign actor therefore:

- does not appear in the protected project's user directory;
- holds no local password, factor, session, or lifecycle owner there;
- is not counted as a protected-project end-user merely because they manage it;
- retains one stable actor identity for audit across every authorized project.

### 2. Grants remain on the protected project

Cross-project authority uses ordinary `authz_assignments` rows. The row carries
the protected `project_id` and a foreign `user` or `team` principal. There is no
`principal_type = project`, no wildcard project object, and no composite foreign
key requiring the principal to exist in the protected project.

For a direct foreign-user grant:

```text
protected project  = proj_customer
principal          = user:user_alice
principal home     = proj_platform
relation           = project.viewer | project.editor | project.admin
```

ADR 046's statement that the claiming human relates to the project through a
team remains normative for **ownership and claim**. A direct user assignment is
ordinary revocable access to an already owned project. It cannot create or
replace the owning-team assignment, complete claim, or make the user the
project's lifecycle/accountability owner.

For a foreign-team grant, the assignment names the team. At check time, the
resolver expands active membership through `authz_membership_edges` in the
team's home project. Membership edges are never copied into the customer
project. A user can match that team userset only when the user and team share
the same home project; cross-project team membership is not introduced.

**Foreign grant principals are platform-homed.** A cross-project `user` or
`team` principal must be homed in the reserved platform project, and the grant
API validates that at write time — a principal homed in another customer
project is rejected, not stored. Without the rule, an app-homed row would sit
inert until §5's credential rules widened, then become live authority nobody
consciously granted. Cross-application automation belongs to the future PAT,
service-user, or token-exchange leg, never to a human grant. Transitionally,
while Console ADR 0004 §2's fallback makes the Console sign-in project a
customer project, that project stands in as the platform home. The invariant
is also what entitles the resolver to evaluate a foreign team's relations in
the caller's home project: principal and team are guaranteed to share it.

The assignment is created, changed, revoked, and audited in the same database
partition as the protected resources, preserving ADR 033's consistency and
residency invariant. Cross-region principal validation is accepted for v1;
traffic is expected to be operator-scale, and a derived membership projection
can be introduced later if measurements justify it.

### 3. The resolver keeps home and target scope separate

Every cross-project check supplies both home and target project IDs. The
resolver evaluates, in order:

1. Resolve the protected project and required relation or permission.
2. Resolve active assignments stored on that protected project.
3. Match a direct user assignment, or expand a team assignment through active
   membership edges in the principal's home project.
4. Evaluate the compiled relation closure and bounded tuple-to-userset rules.
5. Validate the foreign principal's current lifecycle state.
6. Return `Allow`, `Forbidden`, or `NotFound` with the same semantics as local
   checks.

The public resolver and HTTP gate must not replace the home project with the
target project as a convenience default once a user credential has been
resolved. A missing home project for a user principal is an internal error and
fails closed.

Team IDs and user IDs are globally addressable prefixed identifiers, but the
resolver still verifies their home scope and active state. Identifier shape is
not proof that a principal is authorized or still exists.

### 4. Inactive principals fail immediately without grant fan-out

Assignments may deliberately outlive the principal they name. Removing or
deactivating a platform identity must not require rewriting assignments in
every customer project.

- A direct foreign-user assignment allows only while the home-project user is
  active.
- A foreign-team assignment allows only while the team is active and the user
  has an active membership edge in that team.
- Moving a membership to `inactive` or `removed` deletes its authz edge in the
  same transaction, so the next request is denied.
- Reactivation restores only authorization paths whose assignments remain
  active and unexpired.

This is read-time validation over indexed local facts, not eventual cleanup.

### 5. First-party human sessions may call the operator plane

The embedded Console authenticates a human with the existing HttpOnly
`__nextgen_session` cookie. The browser sends that first-party cookie directly
to the same-origin API. For management endpoints that accept a human principal,
the session proves who the human is and the permission resolver decides which
target projects they may act on. The browser sends neither a project secret nor
a script-readable session bearer.

This explicitly amends ADR 036's statement that confidential-plane operations
always authenticate calling software. An **operator-plane operation** may now
authenticate either:

- automation through a confidential project secret and, later, a PAT or
  service-user credential; or
- a human through the first-party Console session cookie.

The operation remains operator-plane because it manages Zitadel resources; it
does not become public-plane merely because its human credential is also used
by public-plane `/me` operations. Credential transport and operation plane are
separate properties. Both paths enter the same authorization resolver after
credential resolution. A future user bearer token uses the same principal and
grant semantics rather than creating another authorization model. The CLI's
platform login — `zitadel login` completing in the browser over the existing
claim handoff transport — is the first planned consumer of that bearer.

Cookie-authenticated state-changing management requests require all of:

- an authenticated, active user session;
- an exact match between the request `Origin` and the server-authoritative
  Console/API public origin, never a target project's allowed-origin list; and
- a session-bound CSRF token in a non-simple request header.

The CSRF token is not an authorization credential without the HttpOnly session
cookie. Safe reads may omit it. This requirement includes
`claim/complete` and supersedes ADR 046's SameSite-only CSRF conclusion if this
ADR is accepted. SameSite remains defense in depth, not the only check.

ADR 046 is already implemented, so this is a wire-contract change rather than
documentation-only hardening. The implementation lands atomically across the
first-party surfaces:

- an authenticated same-origin session surface exposes an opaque,
  session-bound CSRF token to browser code;
- the Console and any browser claim-completion surface send it in the
  `X-Zitadel-CSRF` header on unsafe requests;
- the server validates the header, session binding, and exact Origin before
  executing the mutation; and
- the OpenAPI/generated client, API mock, testkit fixtures, and service-backed
  Console/claim E2E change in the same product update.

Server enforcement must not land before the first-party callers can supply the
token. The CLI's secret-authenticated `claim/init` and `claim/status` legs are
unchanged; only the cookie-authenticated browser leg it opens is affected.

### 6. Project discovery is an authorization query

The Console and CLI need a query that means "projects on which this principal
has at least the requested relation," not "projects belonging to the
credential's home project."

The authorized set is the union of:

- active direct assignments for the user;
- active assignments for teams in which the user has an active membership;
- bounded ownership or other tuple-to-userset relations defined by the active
  system catalog.

The query is evaluated in SQL with an index beginning with
`(principal_type, principal_id)` for active assignments, plus the existing
membership-edge member index. It must not scan all projects and perform one
authorization check per row. Pagination and search compose with the same
authorization predicate.

`GET /me/memberships` remains a home-project roster query. Cross-project
project visibility comes from grants, not from pretending that a project-scoped
user has memberships in foreign customer projects. This corrects the
"memberships across projects" wording in
[`hierarchy.md`](../design/api/hierarchy.md#caller-convenience).

### 7. Denials preserve the project boundary

The ADR 033 denial contract applies unchanged:

- No foothold in the protected project, an unknown protected project, or a
  resource outside every authorized scope returns `404 Not Found`.
- A foothold exists but the required permission is absent returns
  `403 Forbidden`.
- Resolver, principal-validation, or home-project lookup errors fail closed.

For a foreign human principal, an unknown target and a real but unauthorized
target must be indistinguishable. The existing operator delete-idempotency
exception for project secrets does not extend to foreign human sessions.

### 8. Audit events are written in the protected project

Every allowed cross-project mutation and every security-relevant read produces
the same protected-project event as a local actor. It reuses
[ADR 048](048-wide-events-internal-audit-primitive.md)'s existing top-level
columns, with one amendment to that ADR's emit-time rule for `team_id`, called
out below the block:

```text
project_id = proj_customer  # protected target, not the actor's home project
team_id    = ...            # protected-resource scope only, when applicable
actor_id   = user_alice
actor_type = human
```

`team_id` is the amendment. ADR 048 captures it at emit time from the resolved
credential's `ScopeContext`, which for a foreign actor is a team in their home
project — a team the protected project has no business seeing on its own
events. Here the column means protected-resource scope only; the actor's team
moves into the `authorization` metadata below. ADR 048's DDL comment, emit-time
rule, and scope table need the same correction.

The authorization explanation is non-PII metadata on that event rather than a
new event-table column contract:

```json
{
  "authorization": {
    "actor_home_project_id": "proj_platform",
    "assignment_ids": ["asgn_..."],
    "path": "direct | team | owning_team",
    "team_id": "team_..."
  }
}
```

Put plainly, the assignment says **what access exists**; this event metadata
says **which assignment allowed this particular request**. It remains useful
after that assignment is revoked, but it never changes access.
The target project does not gain permission to read the actor's platform user
profile. Audit APIs return the stable actor identifier and non-PII authorization
metadata; any friendly display label is a separately authorized projection,
not a cross-project directory read.

### 9. Deployment-wide operators are a separate authority

No role, membership, or administrative permission on the platform project
implicitly grants access to every project. The platform project is an identity
and customer-collaboration home, not a wildcard authorization object.

For the same reason, the reserved platform project mints **no project secret
by default**. Bootstrap provisions its publishable key — sign-in needs it —
and nothing else. A deployment runs indefinitely with no platform-homed API
credential at all: the Console and the claim ceremony ride the first-party
session (§5) and login rides the publishable key. A blanket-admin secret over
the identity home would reach every customer project transitively through
platform-team rosters; the mitigation is that no such credential exists unless
someone deliberately creates one.

Platform-homed automation therefore has no credential in this ADR. When it is
needed it must be a **named, individually scoped principal** — several keys in
the platform project, each authorized only by its own assignment rows — and
that is a credential the system cannot currently express: `authz_assignments`
knows `user`, `team`, `agent`, `sk_proj`, `sk_team` and no platform-key type,
and OAuth introspection resolves every project secret to the single principal
`(sk_proj, <project_id>)`. Reusing `sk_proj` would collapse every platform key
onto one shared grant set, which is exactly the blanket credential this
section refuses.

Defining that principal — its storage, issuance ceremony, rotation, revocation,
introspection mapping, resolver behavior, and test obligations — belongs with
the PAT / service-user credential §5 already defers, not here. Until that ADR
exists, platform-homed automation is **not available**, and nothing may
approximate it by granting broad roles to a project secret. Test
infrastructure obtains credentials through the testkit's boot contract rather
than through a seed default, so it does not depend on this gap being closed.

The intended first use, when it is specified, is customer-boundary automation:
a team owner mints a key scoped to their own team's authority — creating and
managing the projects that team owns — so the key's blast radius is bounded by
the account that minted it.

Cloud operations and self-hosted break-glass may use an explicit
deployment-wide operator relation or credential. Its issuance, activation,
customer visibility, and audit requirements are defined separately with staff
support governance. It must not be represented as
`project:platform#admin -> every project`, and it must not be approximated by a
platform-homed automation key granted broad roles — the operator credential is
explicit precisely so issuance governance, customer visibility, and audit
posture can attach to it.

## Testing obligations

The implementation is not complete until the shared resolver suites prove,
across PostgreSQL, Spanner, and SQLite:

1. A foreign user with a direct grant can access only the protected project.
2. A foreign team grant expands membership from the home project.
3. Inactive users, teams, and memberships deny immediately.
4. A target-project membership with the same identifiers cannot substitute for
   home-project membership.
5. Unauthorized and nonexistent target projects have the same HTTP result.
6. Authorized-project listing equals the union of direct, team, and ownership
   paths and remains authorization-filtered under pagination.
7. Cookie-authenticated mutations fail without valid Origin and CSRF proof,
   while `claim/complete` and Console management mutations succeed with the
   token issued for that session.
8. No session token or project secret appears in Console-readable runtime data.
9. Audit events identify the foreign actor and assignment path in the protected
   project.

## Consequences

### Positive

- One platform identity can safely administer multiple authorized projects.
- Customer projects keep their user directories and lifecycle ownership
  isolated.
- Team offboarding revokes cross-project access without rewriting every grant.
- Console, CLI, agencies, and future staff support share one resolver path.
- Browser management no longer depends on exposing or proxying project secrets.

### Negative / Risks

- Direct foreign-user checks require a home-project lifecycle lookup.
- Foreign-team checks cross the protected/home project partition boundary.
- Authorized-project listing needs a new principal-first index and careful
  dialect conformance testing.
- Friendly audit actor labels cannot be resolved by reading the platform
  directory from the customer project.

## Rejected alternatives

### Make platform-project administrators global administrators

Rejected because customer owners and project administrators also live in the
platform project. This would collapse every customer boundary into one role.

### Create a shadow user in every protected project

Rejected because identity lifecycle, credentials, billing, and offboarding
would become duplicated and eventually inconsistent.

### Copy team memberships into every protected project

Rejected because one membership mutation would fan out to every project grant,
creating write amplification and stale-revocation risk.

### Mint a target-project token for every Console switch

Rejected for the managed single-deployment MVP. The resolver already evaluates
the protected-project assignment. Token exchange remains a possible future
boundary for federated deployments, not a prerequisite for local cross-project
authorization.

### Use a wildcard project assignment

Rejected because a wildcard object bypasses target-project assignments and
their audit trail, and is not the meaning of an OpenFGA subject wildcard.
Deployment-wide exceptional authority is a separate operator relation, not a
synthetic `project:*` grant.

## Non-goals

- Customer collaboration roles and ownership policy; see ADR 054.
- Staff support tiers, self-grant policy, approval, impersonation, and
  break-glass governance.
- Federated cross-deployment access tokens.
- Framework SDK changes; this is a Console/CLI operator-plane concern.
- A cross-project user-directory API.

## Documentation impact

If accepted, follow-up documentation must:

- update ADR 036 and [`credentials.md`](../design/api/credentials.md) so a
  human management session is an operator-plane credential;
- replace the credential-project equality assumption in
  [`authz.md`](../design/api/authz.md) with explicit home and target scope;
- promote `permission-storage.md` D13 from a depiction into the ratified
  mechanism and add the principal-first project-discovery index;
- correct [`hierarchy.md`](../design/api/hierarchy.md) so `/me/memberships`
  means home-project memberships, while authorized projects come from grants;
- amend ADR 048's emit-time `team_id` rule (§8) so the column carries
  protected-resource scope rather than the resolved credential's team scope,
  update its DDL comment and scope table accordingly, and extend its actor
  metadata with the assignment path that authorized the request;
- amend ADR 046's SameSite-only CSRF conclusion; and
- update the claim/Console OpenAPI, generated client, API mock, testkit, and E2E
  surfaces for the session-bound CSRF header before server enforcement ships.
