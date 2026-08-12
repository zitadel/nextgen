# ADR 032: Permission Catalogs — A Portable Relational FGA Core

> **Status:** Proposed
> **Date:** 2026-07-09
> **Context:** Shared permission model, catalog architecture, and storage/resolver core for internal and external authorization

## Introduction

Two everyday situations need the same underlying answer — "is this action
allowed?" — but come from very different audiences:

- A Zitadel support engineer opens a customer's project to investigate a
  login issue under an explicit staff/support grant (out of scope for this ADR
  series; see issue #333). Before they see anything, the system must decide
  whether they're allowed to view it, and record why.
- A customer's own application — say, an expense-report tool built on
  Zitadel — wants to let their user Alice approve reports but not delete the
  expense policy. The customer defines that permission model themselves;
  Zitadel just has to enforce it and hand back the right claims in Alice's
  token.

Systems like this usually end up with two half-built authorization engines:
one hard-coded set of admin roles for the first case, and a bespoke, more
flexible policy system for the second, each with its own storage, its own
bugs, and its own mental model. This ADR is the umbrella decision that avoids
that split: **one permission engine, one storage model, two catalogs of
policy content.**

This is the first of three related ADRs on permission management:

- **ADR 032 (this document):** the shared decision — one engine, two
  catalogs, and the storage/resolver core both catalogs run on.
- **[ADR 033](033-internal-permission-management.md):** how the **system
  catalog** authorizes Zitadel's own resources (projects, teams, users, apps,
  flows, policies) and agent delegation. (Staff/support access and
  cross-project human identity are tracked separately by
  [issue #333](https://github.com/zitadel/nextgen/issues/333).)
- **[ADR 034](034-external-permission-management.md):** how the **app-group
  catalog** lets customers author their own OpenFGA-flavored policies for
  their own apps.

## Glossary

FGA vocabulary is unusually dense and mostly unfamiliar outside teams who've
worked with Zanzibar-style systems before. This glossary defines the
FGA-engine-internal terms used across all three permission-management ADRs —
vocabulary that has no audience outside this document set. For terms other
design docs already assume the reader knows — **principal**, **scope**,
**`resource_scope_index`**, **delegation** — see
[`docs/design/glossary.md` § 5 Authorization (FGA)](../design/glossary.md#5-authorization-fga)
instead of redefining them here. For Zitadel resource nouns (project, team,
user, app_group, grant, role, team_membership), see the same file's §4
Resources.

| Term | Meaning |
|---|---|
| **FGA (Fine-Grained Authorization)** | An authorization model that decides access per resource and per relationship, instead of checking only a small number of coarse, static roles. |
| **ReBAC (Relationship-Based Access Control)** | Access decided by walking relationships — "Alice is a member of Team X, Team X owns Project Y, so Alice can read Project Y" — rather than only checking a role name. FGA systems are usually ReBAC systems with some RBAC-style bundling on top for convenience. |
| **Relation / permission** | The named action or relationship being checked, e.g. `user.read`, `viewer`, `can_manage`. |
| **Permission expression** | The rule that computes whether a relation/permission holds for a given principal and resource: a direct assignment, a union of other rules, or bounded inheritance across the resource hierarchy. |
| **Tuple** | OpenFGA's atomic fact shape: `(object, relation, user)`, e.g. `(project:42, viewer, user:alice)`. We use tuples as an *authoring and interchange* shape (see §2 below); our runtime storage is relational rows, not a tuple store. |
| **Userset** | A set of principals defined implicitly through a relation on another object — "everyone who is a `member` of `team:9`" — instead of one explicitly listed user. |
| **Tuple-to-userset (TTU)** | A rule that derives a permission on one resource from a relation on a *different*, related resource, e.g. "you can read a document if you're a `viewer` of the project that owns it." |
| **Relation implication / closure** | The precomputed answer to "which relations imply which other relations" for one catalog version, so a single check doesn't have to re-derive the whole rule graph on every request. |
| **Catalog** | A versioned collection of relation/permission definitions, their expressions, and optional bundles. Zitadel has two: the **system catalog** ([ADR 033](033-internal-permission-management.md)) and the **app-group catalog** ([ADR 034](034-external-permission-management.md)). |
| **Grant / assignment** | A stored row binding a principal to a permission or relation at an explicit scope. See [`docs/design/glossary.md`](../design/glossary.md#4-resources) for the canonical **grant** definition; "assignment" is this ADR's storage-layer term for the same row. |
| **OpenFGA DSL / JSON** | The human-authorable and machine-interchange syntax used to describe a permission schema — the input to the compiler pipeline in §2. |
| **Profile** | The bounded subset of OpenFGA's modeling language Zitadel supports, chosen so checks stay portable and predictable on PostgreSQL and Spanner (production peers), with SQLite also exercising the same contract locally. |
| **Contextual tuple** | An OpenFGA fact supplied at check time rather than stored ahead of time. Not supported on request hot paths in our profile (see §2's Unsupported constructs). |
| **Caveat / condition** | An OpenFGA construct that attaches a runtime-evaluated condition to a relationship. Arbitrary caveats are unsupported in our profile when they need non-indexed attribute evaluation. |
| **IR (intermediate representation)** | The normalized internal shape produced after parsing and validating a policy, before it is compiled into relational rows and query plans. |
| **Leopard index / flattening** | A technique (named after Google Zanzibar's Leopard index) for precomputing set membership so deeply nested group/relation checks stay fast, without re-walking the whole graph or rewriting per-member state on every write. See [§ Canonical relational storage](#3-canonical-relational-storage). |

## Context

Zitadel needs one permission model for two surfaces:

1. **Internal permissions** decide whether a principal can read or write a
   Zitadel resource such as a project, team, user, app, flow, or policy.
2. **External permissions** assign app/API permissions to users or teams so
   customer applications can authorize their own resources from token
   claims, introspection, or future authorization APIs.

Legacy Zitadel used runtime-configured internal roles at fixed levels such as
instance, organization, project, and project grant. That matched the legacy
API split, where different APIs owned different levels. The Zitadel API is
resource-oriented: a request can carry only a token and a resource id, and
the server must resolve the resource scope before deciding access. Listing
endpoints must filter in SQL, not fetch rows and check each one in
application code.

The current design docs already lock several adjacent invariants:

- [ADR 024](024-user-team-lifecycle-ownership.md) separates authorization
  from user lifecycle ownership.
- [`docs/design/api/url-architecture.md`](../design/api/url-architecture.md)
  uses a global `resource_scope_index` before authorization and requires
  scope-bound repositories.
- [`docs/design/api/authz.md`](../design/api/authz.md) frames authorization
  as `credential x resolved scope x required permission -> decision`.
- [`internal/storage/AGENTS.md`](../../internal/storage/AGENTS.md) requires
  SQL-first storage that works on PostgreSQL and Spanner (production) and
  SQLite (local default).

Three related issue areas constrain the decision:

- Tenant isolation and data residency need project/tenant boundaries that
  can be enforced before resource data is fetched.
- Cross-project identity needs explicit grants for agencies, consultants,
  staff, and operators instead of assuming a global human account can see
  every duplicated project-scoped user. This ADR only requires that the
  storage/resolver core stay compatible with such grants; the concrete
  grant model is defined separately by
  [issue #333](https://github.com/zitadel/nextgen/issues/333), not by this
  ADR or [ADR 033](033-internal-permission-management.md).
- Agent identity needs first-class principals and scoped delegations, not
  broad inherited user authority.

Prior oxidel design work provides useful reference patterns:

- [ADR-036 (Staff Access and Support Grants)](https://github.com/zitadel/oxidel/blob/main/docs/adr/036-staff-access-support-grants.md) and
  [ADR-041 (Cloud Platform Collaboration Model)](https://github.com/zitadel/oxidel/blob/main/docs/adr/041-cloud-customer-portal-collaboration.md)
  are reference material for issue #333's future ADR, not for this series.
- [ADR-042 (Projects and Apps Use Owner-Org AuthZ)](https://github.com/zitadel/oxidel/blob/main/docs/adr/042-projects-apps-owner-org-authz.md) defines resource-oriented permission names and 403/404 denial semantics.

Fine-grained authorization products are useful references, but external
sidecars are not the implementation target. They need their own tuple store
and must learn about resource existence and attributes through
synchronization, which creates operational overhead and stale-decision risk.
Melange is attractive because it compiles OpenFGA-style models into
PostgreSQL SQL/functions and reports sub-millisecond checks, but its
generated function/RLS approach is PostgreSQL-specific and therefore cannot
be the portable contract while Spanner remains supported.

## Decision

Implement a **portable relational FGA core**. OpenFGA remains the preferred
authoring and interchange shape where it fits (see §2 below for the
compiler pipeline, and [ADR 034](034-external-permission-management.md)
for how the app-group catalog uses it), but the runtime contract is
Zitadel-owned relational state plus dialect-portable query plans.

### 1. One model, two catalogs

Internal and external permissions use the same primitives:

| Primitive | Meaning |
|---|---|
| Permission / relation | Stable action or relation name such as `user.read`, `orders.refund`, `viewer`, or `can_manage`. |
| Permission expression | The compiled rule that derives a permission/relation from direct assignments, usersets, unions, and bounded inheritance. |
| Grant / assignment | Principal, permission/relation, and scope binding. |
| Delegation | Explicit authority granted to an agent or machine principal. |
| Principal | User token, agent, `sk_proj_`, `sk_team_`, origin-bound browser nonce, or future machine principal. |
| Scope | Resolved project/team/resource boundary from the credential, request body/query, or `resource_scope_index`. |

There are two catalogs:

- **System catalog:** Zitadel-owned permissions and optional bundles for
  internal API resources. These replace legacy level-specific role
  semantics. Details in [ADR 033](033-internal-permission-management.md).
- **App-group catalog:** customer-owned permissions, relations, and optional
  role-like bundles for apps/APIs. These replace legacy project
  authorizations and are emitted in tokens and introspection responses
  grouped by app group / app audience. Details in
  [ADR 034](034-external-permission-management.md).

Roles are not a required primitive. They are an optional catalog convenience
when a policy author wants RBAC-style bundles such as `admin` or `support`.
OpenFGA schemas that model access only through relations, attributes encoded
as relations, or computed permissions compile without role definitions.

The permission resolver does not know whether a permission is "internal" or
"external" after catalog lookup. It evaluates the same assignment and scope
rules in both cases; only the catalog content differs.

### 2. OpenFGA parser and profile compiler

Zitadel accepts and emits a documented OpenFGA-compatible profile for
catalog schemas — default or customized, system or app-group — but it
does not run an external OpenFGA service or store the canonical policy as
opaque OpenFGA tuples.

Use the maintained OpenFGA language package for parsing and syntax support:
[`github.com/openfga/language/pkg/go`](https://pkg.go.dev/github.com/openfga/language/pkg/go).
Do not build a custom OpenFGA DSL parser.

The compiler pipeline is:

```
OpenFGA DSL / JSON
  -> upstream OpenFGA language parser / transformer
  -> Zitadel profile validator
  -> Zitadel authz IR
  -> relational catalog rows + query plans
```

The upstream parser owns grammar compatibility, source locations, DSL/JSON
round-tripping, and syntactic validation. Zitadel owns semantic validation
against our supported profile, because the Go package does not currently
provide enough semantic/profile validation for our portability and
performance requirements.

The internal package boundary should be:

| Package | Responsibility |
|---|---|
| `internal/authz/openfga` | Parse DSL/JSON with the upstream language package and normalize it into Zitadel's IR. |
| `internal/authz/profile` | Reject unsupported OpenFGA constructs and enforce bounded, portable rules. |
| `internal/authz/compiler` | Compute relation/permission closure and produce relational catalog mutations/query-plan metadata. |
| `internal/authz/resolver` | Evaluate single-resource checks and produce list predicates against repository metadata. |

**Supported profile.** The profile starts with:

- direct relations,
- relation implication / computed usersets,
- union,
- bounded tuple-to-userset through known Zitadel hierarchy edges
  (`project`, `team`, `app_group`, `app`, `user`),
- userset references for team membership and assignment.

**Unsupported constructs.** The MVP rejects constructs that cannot be
planned predictably across PostgreSQL and Spanner:

- unbounded recursion,
- contextual tuples on request hot paths,
- wildcard expansion for list endpoints,
- arbitrary caveats/conditions that need non-indexed attribute evaluation.

Unsupported OpenFGA constructs fail at policy upload/plan time with explicit
diagnostics, rather than degrading silently or timing out at check time. We
can widen the profile later when benchmarks and dialect support prove the
shape.

This pipeline compiles policy content for both catalogs; the mechanism does
not depend on who authors the input. Today, the system catalog ships a
Zitadel-defined default schema (see
[ADR 033 §1](033-internal-permission-management.md#1-system-catalog)),
while the app-group catalog is customer-authored from the start (see
[ADR 034](034-external-permission-management.md)). Neither is an
architectural ceiling: customizing the system catalog's schema using these
same primitives is anticipated future work, not foreclosed by this ADR.

### 3. Canonical relational storage

Relationships that affect authorization are first-class local rows, not
sidecar-synchronized facts. Per catalog/version, storage holds:

- relation/permission definitions, expression edges, and optional bundle
  aliases;
- relation-implication closure (see below);
- assignments binding principals to permissions or relations at explicit
  scopes.

**What gets recomputed, and when.** Two very different things happen on two
very different schedules:

1. *Policy/schema changes* — a new relation, a new implication rule —
   recompute the relation-implication closure: the answer to "which
   relations imply which other relations" for that catalog version. This is
   rare, and can afford to be somewhat expensive, because it happens once
   per policy version, not once per user action.
2. *Ordinary access changes* — inviting a user to a team, granting a
   permission — write exactly one new row to the relevant assignment/grant
   table. We do **not** eagerly expand that change into every resource or
   user it could eventually affect.

This distinction matters because the naive alternative — maintaining a
fully materialized, per-resource transitive-closure table — creates a
write-amplification problem: adding one user to a 100k-member group would
require touching on the order of 100k downstream rows every time. Instead,
assignment rows stay exactly as numerous as the real assignments made, and
expansion happens at check time, not write time.

At check time, the resolver walks the (small) stored relation rows plus the
precomputed schema-level closure using **indexed semi-joins** — index
lookups that ask "does at least one matching row exist" rather than
materializing every match. This keeps checks cheap without paying a
write-time cost proportional to group size. The approach follows the same
idea popularized as **Leopard indexing** in Zanzibar-style authorization
systems: precompute and flatten the parts of the relationship graph that are
expensive to re-derive per request (deep group nesting, long inheritance
chains), while leaving simple, per-assignment facts as plain rows. See
[Leopard: the C of O(1) indexing systems](https://thediligentengineer.com/leopard-the-c-of-o1-indexing-system)
for the underlying technique.

This is a design intent, not a shipped implementation: the exact shape of
the flattened index is follow-up migration work, and must be validated
against both PostgreSQL and Spanner before we rely on it for hot-path
checks.

Delegations — an agent or machine principal acting with explicit,
time-bounded authority — are stored as assignments with an explicit
grantor, delegation id, expiry/revocation state, and scope, never as a copy
of everything the grantor could do. See [ADR 033](033-internal-permission-management.md)
for how this applies to agent access to internal resources. (Staff/support
delegation is out of scope for this ADR series — see
[issue #333](https://github.com/zitadel/nextgen/issues/333).)

### 4. Resolver: one evaluation path for both catalogs

Every protected endpoint declares:

```
resource_kind
operation
scope_source
required_permissions
```

Single-resource checks use indexed semi-joins over the principal's
assignments, relation/permission closure, credential class constraints, and
resolved scope. List endpoints receive a permission predicate from the
resolver instead of being checked row-by-row after fetch. The resolver code
path is identical for system-catalog and app-group-catalog permissions; only
the catalog rows it reads differ.

[ADR 033](033-internal-permission-management.md) covers how this resolver
is wired into Zitadel's own resource-oriented API, including list filtering
across scopes and the 403/404 denial contract.

PostgreSQL may later use generated SQL functions, views, or RLS as an
accelerator behind the same resolver interface. The portable behavior
remains the application/query-builder path so Spanner and PostgreSQL share
the same authorization semantics.

### 5. Consistency and caching

Permission decisions are cached only inside a request. Compiled policy
metadata, permission ids, and relation closure by catalog version may be
cached across requests because they are immutable by version. Cross-request
decision caching requires an explicit invalidation design and is out of
scope for MVP.

Tenant partitioning and cross-project human identity remain separate
concerns handled in [ADR 033](033-internal-permission-management.md). This
ADR only fixes the shared invariant: authorization rows are stored and
versioned the same way regardless of which catalog they belong to.

## Consequences

### Positive

- One authorization model covers platform administrators, customer project
  admins, service credentials, and end-user app permissions.
- PostgreSQL and Spanner remain first-class production peers; SQLite is the
  local/homelab dialect. Database RLS is optional, not required.
- OpenFGA remains useful for customer-facing policy literacy and future
  interoperability without forcing an external consistency boundary into
  the hot path.
- A single resolver implementation serves both catalogs, so performance and
  correctness work is not duplicated across two engines.
- The implementation does not start with parser work: it reuses the
  maintained OpenFGA language parser and focuses local code on validation,
  compilation, storage, and query planning.

### Negative / Risks

- We own the compiler, validation profile, and SQL plan generation instead
  of delegating them to OpenFGA or Melange.
- The upstream OpenFGA Go language package is only a parser/transformer and
  syntactic validator for our purposes; semantic checks and performance
  bounds remain Zitadel-owned.
- The write-cheap / check-time-expansion storage model (§3) is a design
  intent that still needs a validated, benchmarked implementation on both
  PostgreSQL and Spanner before we can claim it holds under real group
  sizes and nesting depth.
- Optional PostgreSQL accelerators can drift from portable behavior unless
  they run the same conformance tests as the portable path.

## Rejected Alternatives

### Run OpenFGA or SpiceDB as a sidecar

Rejected because it introduces a second source of truth for resource
existence, hierarchy, and attributes. Synchronization lag creates stale
decisions, especially on delete/revoke paths. It also makes list filtering
depend on remote `ListObjects`-style calls instead of one scoped SQL query.

### Adopt Melange as the primary engine

Rejected as the primary engine because Melange generates PostgreSQL-specific
functions and relies on PostgreSQL execution features. It is a strong
reference for schema compilation, relation closure, and optional PostgreSQL
acceleration, but not a portable contract for Spanner.

### Build a custom OpenFGA parser

Rejected because OpenFGA already maintains Go parser/transformer packages
for the DSL and JSON syntax. Building a parser would spend implementation
effort on grammar compatibility instead of Zitadel-specific validation,
relational compilation, and query planning.

### Pure RBAC without ReBAC/FGA

Rejected because it cannot naturally express team membership, parent/child
resource inheritance, app-group grants, and future customer-declared app
policies without reintroducing hard-coded levels and special cases.

## Follow-ups

1. Design relational migrations for catalogs, permission/relation
   definitions, expression edges / relation references, and assignments
   shared by both catalogs.
   Wave 0 DDL spike and locked decisions:
   [`docs/design/api/permission-storage.md`](../design/api/permission-storage.md)
   (implementation tracked by [issue #422](https://github.com/zitadel/nextgen/issues/422)).
   Wave 1 (#422) ships `authz_expression_edges` + `authz_relation_references`
   as compiled #720 storage (superseding the Wave 0 D5/D14 “relations+closure
   only” deferral for MVP); bundle tables remain unfilled by the v1 mapper.
   Catalog-specific tables — `resource_scope_index` and app grants — are
   tracked in [ADR 033](033-internal-permission-management.md) and
   [ADR 034](034-external-permission-management.md); staff/support grant
   product is tracked by [issue #333](https://github.com/zitadel/nextgen/issues/333)
   (storage depiction in the Wave 0 / Wave 1 doc).
2. Add resolver conformance tests that compare single-resource checks and
   list predicates across PostgreSQL and Spanner.
3. Validate the Leopard-style flattening approach for relation closure
   against both dialects before relying on it for hot-path checks.
4. Add the upstream OpenFGA language package and implement the IR/profile
   compiler behind `internal/authz/openfga`.
5. Define the OpenFGA profile grammar and upload diagnostics.
