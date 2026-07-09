# ADR 032: Internal Permission Management (System Catalog)

> **Status:** Proposed
> **Date:** 2026-07-09
> **Context:** Authorization for Zitadel-owned internal resources (projects, teams, users, apps, flows, policies), including staff/support access and agent delegation. Builds on [ADR 031](031-permission-catalogs.md).

## Introduction

nextgen's own API needs to answer questions like: can this token read this
specific project? Can a support engineer temporarily see a customer's
session data to debug a login failure — and can we prove afterwards exactly
who authorized that and why? Can an automated agent acting on a user's
behalf take one specific action without inheriting everything that user
could do?

These are **internal, Zitadel-owned decisions** — they gate access to
Zitadel's own resources (projects, teams, users, apps, flows, policies), not
a customer's downstream application data. That distinction matters because
internal resources are strongly consistent with Zitadel's own database, so
authorization here can (and must) be exact and immediate in a way that isn't
always true once a decision crosses into a customer's own systems (see
[ADR 033](033-external-permission-management.md)).

This ADR defines how internal permissions are catalogued, resolved,
audited, and — for staff, support, and agent access — explicitly granted
rather than implied by role names. It builds on the shared catalog model in
[ADR 031](031-permission-catalogs.md); see that document's glossary for
FGA-engine vocabulary (relation, tuple, userset, catalog) and
[`docs/design/glossary.md` § 5 Authorization (FGA)](../design/glossary.md#5-authorization-fga)
for cross-cutting terms (scope, principal, `resource_scope_index`, delegation).

## Glossary

Terms specific to internal/system-catalog authorization, in addition to
[ADR 031's glossary](031-permission-catalogs.md#glossary) and
[`docs/design/glossary.md` § 5](../design/glossary.md#5-authorization-fga):

| Term | Meaning |
|---|---|
| **System catalog** | The catalog of Zitadel-owned permissions and optional bundles for internal API resources; replaces legacy level-specific role semantics. See [ADR 031 §1](031-permission-catalogs.md#1-one-model-two-catalogs). |
| **Credential class** | The kind of principal presenting a request (user token, `sk_proj_`, `sk_team_`, origin-bound browser nonce), which constrains which permissions/scopes are even reachable regardless of grants. |
| **Staff/support grant tier** | One of four named permission sets (`support.read` … `support.admin`) that bound what a scoped, time-limited staff grant can do. |
| **Break-glass access** | An escape hatch for platform operators when normal grant issuance is unavailable; skips grant issuance but still produces audit events. |
| **Agent delegation** | A scoped, explicit, auditable grant of authority from a human or service principal to an agent, distinct from the agent inheriting the grantor's full permission set. |

## Context

Legacy Zitadel used runtime-configured internal roles at fixed levels such
as instance, organization, project, and project grant. That matched the
legacy API split, where different APIs owned different levels. The nextgen
API is resource-oriented: a request can carry only a token and a resource
id, and the server must resolve the resource scope before deciding access.
Listing endpoints must filter in SQL, not fetch rows and check each one in
application code.

The current design docs already lock several adjacent invariants this ADR
must respect:

- [ADR 024](024-user-team-lifecycle-ownership.md) separates authorization
  from user lifecycle ownership: FGA decides whether an action is allowed;
  it does not decide whether a user or team should be deprovisioned.
- [`docs/design/api/url-architecture.md`](../design/api/url-architecture.md)
  uses a global `resource_scope_index` before authorization and requires
  scope-bound repositories.
- [`docs/design/api/authz.md`](../design/api/authz.md) frames authorization
  as `credential x resolved scope x required permission -> decision`.
- [`internal/storage/AGENTS.md`](../../internal/storage/AGENTS.md) requires
  SQL-first storage that works on both PostgreSQL and Spanner.

Three related issue areas constrain the decision:

- Tenant isolation and data residency need project/tenant boundaries that
  can be enforced before resource data is fetched.
- Cross-project identity needs explicit grants for agencies, consultants,
  staff, and operators instead of assuming a global human account can see
  every duplicated project-scoped user.
- Agent identity needs first-class principals and scoped delegations, not
  broad inherited user authority.

Prior oxidel design work provides useful reference patterns:

- [ADR-036 (Staff Access and Support Grants)](https://github.com/zitadel/oxidel/blob/main/docs/adr/036-staff-access-support-grants.md) defines scoped, time-limited staff grants with four privilege tiers and an explicit audit-trail contract.
- [ADR-041 (Cloud Platform Collaboration Model)](https://github.com/zitadel/oxidel/blob/main/docs/adr/041-cloud-customer-portal-collaboration.md) establishes org membership as the share primitive for cross-project access.
- [ADR-042 (Projects and Apps Use Owner-Org AuthZ)](https://github.com/zitadel/oxidel/blob/main/docs/adr/042-projects-apps-owner-org-authz.md) defines resource-oriented permission names and 403/404 denial semantics.

## Decision

### 1. System catalog

The system catalog holds Zitadel-owned permissions and optional bundles for
internal API resources, using the shared primitives defined in
[ADR 031 §1](031-permission-catalogs.md#1-one-model-two-catalogs)
(permission/relation, permission expression, grant/assignment, delegation,
principal, scope). It replaces legacy level-specific role semantics: instead
of a role fixed to "instance admin" or "project admin", a permission such as
`project.settings.write` is granted at an explicit, resolved scope.

### 2. `resource_scope_index` and canonical storage

`resource_scope_index` maps globally-addressable resources to project/team
scope and is consulted by middleware *before* authorization runs (see
[`docs/design/api/url-architecture.md`](../design/api/url-architecture.md)).
`team_memberships` owns roster/status/provisioning state and can feed
authorization facts, but remains separate from lifecycle ownership per
[ADR 024](024-user-team-lifecycle-ownership.md).

Authorization facts for local Zitadel resources live in the same database
as the resources they protect and are updated in the **same transaction**
whenever a resource mutation changes access. This ADR requires authorization
rows to be stored with the same residency/partition metadata as the
resources they protect, and requires all cross-project staff, operator,
agency, and support access to be represented as explicit grants with scope,
expiry, grantor, and audit provenance — never as a side effect of role
naming.

### 3. Agent delegation

Agent delegations are stored as assignments with an explicit grantor,
delegation id, expiry/revocation state, and scope (the general storage
shape from [ADR 031 §2](031-permission-catalogs.md#2-canonical-relational-storage)).
An agent never receives permissions by copying all permissions from its
owner. The resolver must be able to explain which delegation authorized or
denied an agent action, so that both audit review and the agent itself can
see exactly why an action succeeded or failed.

### 4. Staff and support grants

Staff and support grants use the same storage shape as any other
assignment: each record carries a `grant_id`, issuer principal,
human-readable `reason`, role tier, expiry timestamp, and revocation state
alongside the standard assignment tuple. The authoritative grant record
drives both access decisions and audit export — there is no separate access
path that bypasses the grant check. Cross-project privileged access is
modeled through four tiers in the system catalog:

| Tier | Permitted scope |
|---|---|
| `support.read` | Read resources, sessions, event streams, and settings |
| `support.write` | Above plus reset credentials, revoke sessions, suspend/unsuspend principals |
| `support.config` | Above plus modify resource configuration and policy |
| `support.admin` | Full delegated access including impersonation grants |

Each tier is a named permission set in the system catalog, not a runtime
bypass. Tier escalation requires a new grant at the higher tier; chaining
lower-tier grants cannot yield higher-tier access.

### 5. Resolver and list filtering for internal resources

Every protected internal endpoint declares:

```
resource_kind
operation
scope_source
required_permissions
```

The request pipeline is:

```
credential -> resolve path/body/query scope -> permission resolver -> scope-bound DAL
```

Single-resource checks use indexed semi-joins over the principal's
assignments, relation/permission closure, credential class constraints, and
resolved scope (mechanism defined in
[ADR 031 §2–3](031-permission-catalogs.md#2-canonical-relational-storage)).

List endpoints receive a permission predicate from the resolver and inject
it into the resource query. Repositories tell the predicate builder which
resource columns carry `project_id`, `team_id`, and any owner/resource
identifiers. The database filters rows in one query; the API never performs
O(n) per-row permission checks after fetching a result page. For list
endpoints that span authorization scopes, the resolver first derives the
set of project/team scopes the caller is authorized to read, then
constrains the query to rows owned by those scopes, instead of returning all
rows and filtering post-fetch.

**Denial semantics.** The resolver enforces a strict two-code contract:

- Principal is authorized to the project/resource scope but lacks the
  required permission → `403 Forbidden`.
- Resource does not exist within the resolved scope, or principal lacks any
  access to the scope boundary → `404 Not Found`.

This distinction prevents information leakage about resource existence
across project scopes while still giving authorized callers an actionable
error. It is consistent with the enumeration-oracle protection already
locked in [`docs/design/api/url-architecture.md`](../design/api/url-architecture.md).

PostgreSQL may later use generated SQL functions, views, or RLS as an
accelerator behind the same resolver interface. The portable behavior
remains the application/query-builder path so Spanner and PostgreSQL share
the same authorization semantics.

### 6. Audit trail and grant provenance

Every action performed under a scoped grant or agent delegation records the
grant context in the event actor metadata:

```
actor:     staff:alice
grant_id:  grant-123
reason:    "SUPPORT-456: customer reports login failures"
role:      support.write
action:    session.revoke
target:    user:bob
```

This makes support actions and delegated agent actions visible in the
resource owner's audit log. There is no hidden access path: the grant check
and the audit record are the same code path.

A break-glass escape hatch (equivalent to oxidel's `operator_admin`) must be
defined for platform operators when normal grant issuance is unavailable.
Unlike regular grants, break-glass access skips the grant-issuance flow but
still produces audit events. Break-glass design is deferred to a follow-up.

## Consequences

### Positive

- Internal checks are resource-based and compatible with flat-by-ID APIs.
- Listing queries remain single-roundtrip SQL with injected predicates.
- Local resource authorization is strongly consistent with local resource
  writes.
- Staff, support, and agent access are always explicit, scoped, expiring,
  and audited — there is no implicit "admin can see everything" path.

### Negative / Risks

- Predicate injection increases repository/query-builder complexity and
  needs focused tests for every scoped resource type.
- Optional PostgreSQL accelerators (generated functions, RLS) can drift from
  portable behavior unless they run the same conformance tests as the
  application/query-builder path.
- The break-glass mechanism is a real operational necessity but also a
  standing risk if its audit trail is ever weaker than the standard grant
  path; its design needs the same scrutiny as regular grants.

## Rejected Alternatives

### Keep legacy leveled InternalAuthZ

Rejected because resource-oriented APIs cannot rely on fixed API levels. A
user id does not reveal its organization/team scope until the server
resolves it, and list endpoints need SQL filtering across mixed assignment
levels.

### Run OpenFGA or SpiceDB as a sidecar for internal resources

Rejected for the same reasons as the core architecture decision (see
[ADR 031](031-permission-catalogs.md#rejected-alternatives)), with extra
force for internal resources specifically: synchronization lag would create
stale decisions on delete/revoke paths for Zitadel's own data, and list
filtering would depend on remote `ListObjects`-style calls instead of one
scoped SQL query against data we already own.

## Follow-ups

1. Define the exact system permission catalog and optional default bundles.
   Use resource-oriented naming consistent with the ADR-042 pattern — e.g.
   `project.create`, `project.read`, `project.write`, `project.delete`,
   `project.app.read`, `project.app.write`, `project.app.delete` — and
   extend to all nextgen resource types.
2. Design relational migrations for `resource_scope_index`, staff/support
   grant tables, and agent delegation tables.
3. Update OpenAPI security declarations to use the final permission names.
4. Define agent delegation schema, audit record shape, and denial
   explanation fields.
5. Define the break-glass access mechanism for platform operators when
   normal grant issuance is unavailable, specifying which checks it
   bypasses and what audit events it must emit.
