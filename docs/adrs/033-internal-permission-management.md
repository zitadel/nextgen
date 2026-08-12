# ADR 033: Internal Permission Management (System Catalog)

> **Status:** Proposed
> **Date:** 2026-07-09
> **Context:** Authorization for Zitadel-owned internal resources (projects, teams, users, apps, flows, policies) and agent delegation. Builds on [ADR 032](032-permission-catalogs.md).

## Introduction

Zitadel's own API needs to answer questions like: can this token read this
specific project? Can it list only the teams a caller actually has access
to, in one SQL query, instead of fetching everything and filtering in
application code? Can an automated agent acting on a user's behalf take one
specific action without inheriting everything that user could do?

These are **internal, Zitadel-owned decisions** — they gate access to
Zitadel's own resources (projects, teams, users, apps, flows, policies), not
a customer's downstream application data. That distinction matters because
internal resources are strongly consistent with Zitadel's own database, so
authorization here can (and must) be exact and immediate in a way that isn't
always true once a decision crosses into a customer's own systems (see
[ADR 034](034-external-permission-management.md)).

This ADR defines how internal permissions are catalogued, resolved, and
audited, and how agent access is explicitly granted rather than implied by
role names. It builds on the shared catalog model in
[ADR 032](032-permission-catalogs.md); see that document's glossary for
FGA-engine vocabulary (relation, tuple, userset, catalog) and
[`docs/design/glossary.md` § 5 Authorization (FGA)](../design/glossary.md#5-authorization-fga)
for cross-cutting terms (scope, principal, `resource_scope_index`, delegation).

**Out of scope:** staff/support access, cross-project human identity
(agencies, consultants, platform operators), and the break-glass escape
hatch are deliberately not defined here. They're the subject of a separate,
open architecture question — [issue #333, "Define Architecture for
Cross-Project Identity and Collaboration"](https://github.com/zitadel/nextgen/issues/333)
— which needs its own focused ADR rather than a subsection of this one.
This ADR's resolver and audit-trail mechanisms (§4–5 below) are generic
enough to support whatever that future ADR defines, without modification.

## Glossary

Terms specific to internal/system-catalog authorization, in addition to
[ADR 032's glossary](032-permission-catalogs.md#glossary) and
[`docs/design/glossary.md` § 5](../design/glossary.md#5-authorization-fga):

| Term | Meaning |
|---|---|
| **System catalog** | The catalog of Zitadel-owned permissions and optional bundles for internal API resources; replaces legacy level-specific role semantics. See [ADR 032 §1](032-permission-catalogs.md#1-one-model-two-catalogs). |
| **Credential class** | The kind of principal presenting a request (user token, `sk_proj_`, `sk_team_`, origin-bound browser nonce), which constrains which permissions/scopes are even reachable regardless of grants. |
| **Agent delegation** | A scoped, explicit, auditable grant of authority from a human or service principal to an agent, distinct from the agent inheriting the grantor's full permission set. |

## Context

Legacy Zitadel used runtime-configured internal roles at fixed levels such
as instance, organization, project, and project grant. That matched the
legacy API split, where different APIs owned different levels. The Zitadel
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
  SQL-first storage that works on PostgreSQL and Spanner (production) and
  SQLite (local default).

Two related issue areas constrain the decision:

- Tenant isolation and data residency need project/tenant boundaries that
  can be enforced before resource data is fetched.
- Agent identity needs first-class principals and scoped delegations, not
  broad inherited user authority.

Cross-project human identity (agencies, consultants, platform staff, and
operators) is a related but distinct issue area, tracked by
[issue #333](https://github.com/zitadel/nextgen/issues/333) and out of
scope here — see the Introduction.

Prior oxidel design work provides a useful reference pattern for this ADR's
scope:

- [ADR-042 (Projects and Apps Use Owner-Org AuthZ)](https://github.com/zitadel/oxidel/blob/main/docs/adr/042-projects-apps-owner-org-authz.md) defines resource-oriented permission names and 403/404 denial semantics.

(ADR-036 "Staff Access and Support Grants" and ADR-041 "Cloud Platform
Collaboration Model" are relevant reference material for #333's future ADR,
not for this one.)

## Decision

### 1. System catalog

The system catalog holds Zitadel-owned permissions and optional bundles for
internal API resources, using the shared primitives defined in
[ADR 032 §1](032-permission-catalogs.md#1-one-model-two-catalogs)
(permission/relation, permission expression, grant/assignment, delegation,
principal, scope). It replaces legacy level-specific role semantics: instead
of a role fixed to "instance admin" or "project admin", a permission such as
`project.write` is granted at an explicit, resolved scope.

The system catalog ships a **Zitadel-defined default schema** built from
those primitives: RBAC-style bundles today (see [ADR 032 §1](032-permission-catalogs.md#1-one-model-two-catalogs)'s
"roles are optional convenience" framing), with room to grow into
ReBAC-style relations — e.g. user groups — later. Definitions are authored
and compiled through the same OpenFGA-flavored pipeline as the app-group
catalog (see [ADR 032 §2](032-permission-catalogs.md#2-openfga-parser-and-profile-compiler));
only the storage rows differ, not the mechanism.

This is not a permanent restriction to Zitadel-only authorship. Customizing
the system catalog's schema beyond the shipped default — using the same
primitives and pipeline — is anticipated future work, not decided here. A
real motivating case: a customer running an AI agent that manages that
customer's own Zitadel resources (projects, teams, users) may eventually
need a tailored internal permission schema, not just the default one. See
Follow-ups.

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
resources they protect. Cross-project staff, operator, agency, and support
access is out of scope here (see Introduction, [#333](https://github.com/zitadel/nextgen/issues/333));
whatever grant model that future ADR defines must fit this same
storage/residency invariant, not bypass it.

### 3. Agent delegation

Agent delegations are stored as assignments with an explicit grantor,
delegation id, expiry/revocation state, and scope (the general storage
shape from [ADR 032 §3](032-permission-catalogs.md#3-canonical-relational-storage)).
An agent never receives permissions by copying all permissions from its
owner. The resolver must be able to explain which delegation authorized or
denied an agent action, so that both audit review and the agent itself can
see exactly why an action succeeded or failed.

### 4. Resolver and list filtering for internal resources

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
[ADR 032 §3–4](032-permission-catalogs.md#3-canonical-relational-storage)).

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

### 5. Audit trail and grant provenance

Every action performed under an explicit grant or agent delegation records
the grant context in the event actor metadata. For example, an agent acting
under a delegation:

```
actor:        agent:report-bot
delegation_id: delegation-123
grantor:      user:alice
action:       project.export.create
target:       project:42
```

This makes delegated agent actions visible in the resource owner's audit
log. There is no hidden access path: the grant check and the audit record
are the same code path. (The equivalent shape for staff/support grants —
issuer, human-readable `reason`, role tier, and a break-glass escape hatch
for when normal grant issuance is unavailable — is defined by
[#333](https://github.com/zitadel/nextgen/issues/333)'s future ADR, using
this same actor-metadata mechanism.)

## Consequences

### Positive

- Internal checks are resource-based and compatible with flat-by-ID APIs.
- Listing queries remain single-roundtrip SQL with injected predicates.
- Local resource authorization is strongly consistent with local resource
  writes.
- Agent access is always explicit, scoped, expiring, and audited — there is
  no implicit "agent inherits everything its owner can do" path.

### Negative / Risks

- Predicate injection increases repository/query-builder complexity and
  needs focused tests for every scoped resource type.
- Optional PostgreSQL accelerators (generated functions, RLS) can drift from
  portable behavior unless they run the same conformance tests as the
  application/query-builder path.

## Rejected Alternatives

### Keep legacy leveled InternalAuthZ

Rejected because resource-oriented APIs cannot rely on fixed API levels. A
user id does not reveal its organization/team scope until the server
resolves it, and list endpoints need SQL filtering across mixed assignment
levels.

### Run OpenFGA or SpiceDB as a sidecar for internal resources

Rejected for the same reasons as the core architecture decision (see
[ADR 032](032-permission-catalogs.md#rejected-alternatives)), with extra
force for internal resources specifically: synchronization lag would create
stale decisions on delete/revoke paths for Zitadel's own data, and list
filtering would depend on remote `ListObjects`-style calls instead of one
scoped SQL query against data we already own.

## Follow-ups

1. Define the exact system permission catalog and optional default bundles.
   Use resource-oriented naming consistent with the ADR-042 pattern — e.g.
   `project.create`, `project.read`, `project.write`, `project.delete`,
   `app.read`, `app.write`, `app.delete` — and extend to all Zitadel resource
   types. Canonical names live in
   [`docs/design/api/system-permission-catalog.md`](../design/api/system-permission-catalog.md).
2. Design relational migrations for `resource_scope_index` and agent
   delegation columns on `authz_assignments` (D2 — not sibling delegation
   tables). Wave 0 DDL spike and locked decisions:
   [`docs/design/api/permission-storage.md`](../design/api/permission-storage.md)
   (implementation tracked by [issue #422](https://github.com/zitadel/nextgen/issues/422)).
3. Update OpenAPI security declarations to use the final permission names.
4. Define agent delegation schema, audit record shape, and denial
   explanation fields.
5. Staff/support access, cross-project human identity, and the break-glass
   escape hatch are tracked by [issue #333](https://github.com/zitadel/nextgen/issues/333)
   and intentionally out of scope here.
6. Define how system-catalog schema customization (beyond the shipped
   default) would work — using the primitives and pipeline from
   [ADR 032 §2](032-permission-catalogs.md#2-openfga-parser-and-profile-compiler) —
   including who is authorized to customize it and how a customized schema
   coexists with the default. Out of scope for this ADR round.
