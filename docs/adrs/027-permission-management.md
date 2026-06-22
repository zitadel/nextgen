# ADR 027: Permission Management

> **Status:** Proposed
> **Date:** 2026-06-22
> **Context:** Internal authorization, external app permissions, and portable FGA

## Context

nextgen needs one permission model for two surfaces:

1. **Internal permissions** decide whether a principal can read or write a
   Zitadel resource such as a project, team, user, app, flow, or policy.
2. **External permissions** assign app/API roles to users or teams so customer
   applications can authorize their own resources from token claims,
   introspection, or future authorization APIs.

Legacy Zitadel used runtime-configured internal roles at fixed levels such as
instance, organization, project, and project grant. That matched the legacy API
split, where different APIs owned different levels. The nextgen API is
resource-oriented: a request can carry only a token and a resource id, and the
server must resolve the resource scope before deciding access. Listing endpoints
must filter in SQL, not fetch rows and check each one in application code.

The current design docs already lock several adjacent invariants:

- [ADR 024](024-user-team-lifecycle-ownership.md) separates authorization from
  user lifecycle ownership.
- [`docs/design/api/url-architecture.md`](../design/api/url-architecture.md)
  uses a global `resource_scope_index` before authorization and requires
  scope-bound repositories.
- [`docs/design/api/authz.md`](../design/api/authz.md) frames authorization as
  `credential x resolved scope x required permission -> decision`.
- `internal/storage/AGENTS.md` requires SQL-first storage that works on both
  PostgreSQL and Spanner.

Three related issue areas constrain the decision:

- Tenant isolation and data residency need project/tenant boundaries that can
  be enforced before resource data is fetched.
- Cross-project identity needs explicit grants for agencies, consultants,
  staff, and operators instead of assuming a global human account can see every
  duplicated project-scoped user.
- Agent identity needs first-class principals and scoped delegations, not broad
  inherited user authority.

Fine-grained authorization products are useful references, but external
sidecars are not the implementation target. They need their own tuple store and
must learn about resource existence and attributes through synchronization,
which creates operational overhead and stale-decision risk for local Zitadel
resources. Melange is attractive because it compiles OpenFGA-style models into
PostgreSQL SQL/functions and reports sub-millisecond checks, but its generated
function/RLS approach is PostgreSQL-specific and therefore cannot be the
portable contract while Spanner remains supported.

## Decision

Implement a **portable relational FGA core**. OpenFGA remains the preferred
authoring and interchange shape where it fits, but the runtime contract is
Zitadel-owned relational state plus dialect-portable query plans.

### 1. One model, two catalogs

Internal and external permissions use the same primitives:

| Primitive | Meaning |
|---|---|
| Permission | Stable dotted action string such as `users.read` or `orders.refund`. |
| Role | Named bundle of permissions inside a permission catalog. |
| Grant / assignment | Principal, role, and scope binding. |
| Delegation | Explicit authority granted to an agent or machine principal. |
| Principal | User token, agent, `sk_proj_`, `sk_team_`, origin-bound browser nonce, or future machine principal. |
| Scope | Resolved project/team/resource boundary from the credential, request body/query, or `resource_scope_index`. |

There are two catalogs:

- **System catalog:** Zitadel-owned permissions and roles for internal API
  resources. These replace legacy level-specific role semantics.
- **App-group catalog:** customer-owned roles and permissions for apps/APIs.
  These replace legacy project authorizations and are emitted in tokens and
  introspection responses grouped by app group / app audience.

The permission resolver does not know whether a permission is "internal" or
"external" after catalog lookup. It evaluates the same assignment and scope
rules in both cases.

### 2. OpenFGA parser and profile compiler

Zitadel should accept and emit a documented OpenFGA-compatible profile for
app-group policies, but it must not run an external OpenFGA service or store the
canonical policy as opaque OpenFGA tuples.

Use the maintained OpenFGA language package for parsing and syntax support:
`github.com/openfga/language/pkg/go`. Do not build a custom OpenFGA DSL parser.

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
provide enough semantic/profile validation for our portability and performance
requirements.

The internal package boundary should be:

| Package | Responsibility |
|---|---|
| `internal/authz/openfga` | Parse DSL/JSON with the upstream language package and normalize it into Zitadel's IR. |
| `internal/authz/profile` | Reject unsupported OpenFGA constructs and enforce bounded, portable rules. |
| `internal/authz/compiler` | Compute role/relation closure and produce relational catalog mutations/query-plan metadata. |
| `internal/authz/resolver` | Evaluate single-resource checks and produce list predicates against repository metadata. |

The supported profile starts with:

- direct relations,
- role implication / computed usersets,
- union,
- bounded tuple-to-userset through known Zitadel hierarchy edges
  (`project`, `team`, `app_group`, `app`, `user`),
- userset references for team membership and role assignment.

The MVP rejects constructs that cannot be planned predictably across
PostgreSQL and Spanner:

- unbounded recursion,
- contextual tuples on request hot paths,
- wildcard expansion for list endpoints,
- arbitrary caveats/conditions that need non-indexed attribute evaluation.

Unsupported OpenFGA constructs fail at policy upload/plan time with explicit
diagnostics. We can widen the profile later when benchmarks and dialect support
prove the shape.

### 3. Canonical relational storage

Relationships that affect authorization are first-class local rows, not
sidecar-synchronized facts:

- `resource_scope_index` maps globally-addressable resources to project/team
  scope.
- `team_memberships` owns roster/status/provisioning state and can feed FGA
  facts, but remains separate from lifecycle ownership per ADR 024.
- role definitions, permission definitions, role-permission edges, and
  role-implication closure are stored per catalog/version.
- assignments bind principals to roles at explicit scopes.
- app grants bind users or teams to apps/app groups for token claims.

Role implication closure is computed on policy/schema update, not on every
membership or grant write. Ordinary access changes write ordinary indexed rows.
This avoids a noisy-neighbour write penalty from maintaining per-resource
transitive closure tables while still making checks cheap.

Agent delegations are stored as assignments with an explicit grantor,
delegation id, expiry/revocation state, and scope. An agent never receives
permissions by copying all permissions from its owner. The resolver must be able
to explain which delegation authorized or denied an agent action for audit.

### 4. Resolver and list filtering

Every protected endpoint declares:

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

Single-resource checks use indexed semi-joins over the principal's assignments,
role-permission closure, credential class constraints, and resolved scope.

List endpoints receive a permission predicate from the resolver and inject it
into the resource query. Repositories tell the predicate builder which resource
columns carry `project_id`, `team_id`, and any owner/resource identifiers. The
database filters rows in one query; the API never performs O(n) per-row
permission checks after fetching a result page.

PostgreSQL may later use generated SQL functions, views, or RLS as an
accelerator behind the same resolver interface. The portable behavior remains
the application/query-builder path so Spanner and PostgreSQL share the same
authorization semantics.

### 5. Consistency and caching

Authorization facts for local Zitadel resources live in the same database as
the resources they protect and are updated in the same transaction whenever a
resource mutation changes access.

Permission decisions are cached only inside a request. Compiled policy metadata,
permission ids, and role closure by catalog version may be cached across
requests because they are immutable by version. Cross-request decision caching
requires an explicit invalidation design and is out of scope for MVP.

External resource existence outside Zitadel is out of scope. For now, external
permissions authorize app/API access and are exposed as claims. A future
customer-resource FGA API must define how external resources are imported,
versioned, and made causally fresh before Zitadel evaluates checks for them.

Tenant partitioning and cross-project human identity remain separate ADRs. This
ADR requires authorization rows to be stored with the same residency/partition
metadata as the resources they protect, and it requires all cross-project staff,
operator, agency, and support access to be represented as explicit grants with
scope, expiry, grantor, and audit provenance.

## Consequences

### Positive

- One authorization model covers platform administrators, customer project
  admins, service credentials, and end-user app roles.
- Internal checks are resource-based and compatible with flat-by-ID APIs.
- Listing queries remain single-roundtrip SQL with injected predicates.
- Local resource authorization is strongly consistent with local resource
  writes.
- PostgreSQL and Spanner remain first-class; database RLS is optional, not
  required.
- OpenFGA remains useful for customer-facing policy literacy and future
  interoperability without forcing an external consistency boundary into the
  hot path.
- The implementation does not start with parser work: it reuses the maintained
  OpenFGA language parser and focuses local code on validation, compilation,
  storage, and query planning.

### Negative / Risks

- We own the compiler, validation profile, and SQL plan generation instead of
  delegating them to OpenFGA or Melange.
- The OpenFGA profile is intentionally smaller than full OpenFGA; customers may
  expect unsupported constructs unless the product clearly labels the profile.
- The upstream OpenFGA Go language package is only a parser/transformer and
  syntactic validator for our purposes; semantic checks and performance bounds
  remain Zitadel-owned.
- Predicate injection increases repository/query-builder complexity and needs
  focused tests for every scoped resource type.
- App-group role claims can grow large; token issuance must define audience,
  scope request, and claim-size limits.
- Optional PostgreSQL accelerators can drift from portable behavior unless they
  run the same conformance tests.

## Rejected Alternatives

### Keep legacy leveled InternalAuthZ

Rejected because resource-oriented APIs cannot rely on fixed API levels. A user
id does not reveal its organization/team scope until the server resolves it, and
list endpoints need SQL filtering across mixed assignment levels.

### Run OpenFGA or SpiceDB as a sidecar for internal resources

Rejected for local resource authorization because it introduces a second source
of truth for resource existence, hierarchy, and attributes. Synchronization lag
creates stale decisions, especially on delete/revoke paths. It also makes list
filtering depend on remote `ListObjects` style calls instead of one scoped SQL
query.

### Adopt Melange as the primary engine

Rejected as the primary engine because Melange generates PostgreSQL-specific
functions and relies on PostgreSQL execution features. It is a strong reference
for schema compilation, role closure, and optional PostgreSQL acceleration, but
not a portable contract for Spanner.

### Build a custom OpenFGA parser

Rejected because OpenFGA already maintains Go parser/transformer packages for
the DSL and JSON syntax. Building a parser would spend implementation effort on
grammar compatibility instead of Zitadel-specific validation, relational
compilation, and query planning.

### Pure RBAC without ReBAC/FGA

Rejected because it cannot naturally express team membership, parent/child
resource inheritance, app-group grants, and future customer-declared app
policies without reintroducing hard-coded levels and special cases.

## Follow-ups

1. Define the exact system permission catalog and default system roles.
2. Design relational migrations for catalogs, roles, grants, assignments,
   app grants, and `resource_scope_index`.
3. Add the upstream OpenFGA language package and implement the IR/profile
   compiler behind `internal/authz/openfga`.
4. Define the OpenFGA profile grammar and upload diagnostics.
5. Add resolver conformance tests that compare single-resource checks and list
   predicates across PostgreSQL and Spanner.
6. Update OpenAPI security declarations to use the final permission names.
7. Define token claim shape, app-group grouping, and claim-size limits for
   external permissions.
8. Define agent delegation schema, audit record shape, and denial explanation
   fields.
