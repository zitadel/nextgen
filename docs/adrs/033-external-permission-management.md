# ADR 033: External Permission Management (App-Group Catalog & OpenFGA Profile)

> **Status:** Proposed
> **Date:** 2026-07-09
> **Context:** Authorization for customer-owned apps/APIs — app-group catalog, OpenFGA-flavored policy authoring, and token claims. Builds on [ADR 031](031-permission-catalogs.md).

## Introduction

Customers build their own applications on top of Zitadel and want to define
their own authorization rules for their own users. An expense-report app
might want a `submitter` role that can create reports and an `approver`
role that can approve them, scoped to one team; a project-management app
might want per-board `viewer`/`editor` relations. Zitadel doesn't run those
apps and doesn't know their business logic, so it needs to let customers
**author their own permission models**, compile them safely, and expose the
result as token claims or introspection data their app can trust — without
forcing customers to stand up and keep in sync a separate authorization
service of their own.

This ADR defines the **app-group catalog**: how customer policies are
authored using a bounded, well-known subset of the OpenFGA modeling
language, validated, compiled, and evaluated. It builds on the shared
catalog model in [ADR 031](031-permission-catalogs.md); see that document's
glossary for FGA-engine vocabulary (relation, tuple, userset, catalog) and
[`docs/design/glossary.md` § 5 Authorization (FGA)](../design/glossary.md#5-authorization-fga)
for cross-cutting terms (scope, principal, delegation), and
[ADR 032](032-internal-permission-management.md) for how the *other*
catalog — Zitadel's own internal resources — is authorized.

## Glossary

Terms specific to external/app-group authorization, in addition to
[ADR 031's glossary](031-permission-catalogs.md#glossary) and
[`docs/design/glossary.md` § 5](../design/glossary.md#5-authorization-fga):

| Term | Meaning |
|---|---|
| **App-group catalog** | The catalog of customer-owned permissions, relations, and optional bundles for apps/APIs; replaces legacy project authorizations. See [ADR 031 §1](031-permission-catalogs.md#1-one-model-two-catalogs). |
| **OpenFGA DSL / JSON** | The human-authorable and machine-interchange syntax customers use to describe their permission model — the input to the compiler pipeline below. |
| **Profile** | The bounded subset of OpenFGA's modeling language Zitadel supports, chosen so checks stay portable and predictable on both PostgreSQL and Spanner. |
| **Contextual tuple** | An OpenFGA fact supplied at check time rather than stored ahead of time. Not supported on request hot paths in our profile (see § Unsupported constructs). |
| **Caveat / condition** | An OpenFGA construct that attaches a runtime-evaluated condition to a relationship. Arbitrary caveats are unsupported in our profile when they need non-indexed attribute evaluation. |
| **App grant** | A stored row binding a user or team to an app or app-group, feeding token claims / introspection responses. |
| **Token claim** | The app-group permission data embedded in an OIDC access token or returned from introspection, which the customer's app reads locally instead of calling back into Zitadel per request. |

## Context

External permissions assign app/API permissions to users or teams so that
customer applications can authorize their own resources from token claims,
introspection, or future authorization APIs. This replaces legacy project
authorizations, which were emitted per legacy API level rather than grouped
by app/app-group audience.

Fine-grained authorization products (OpenFGA, SpiceDB) and compilers
(Melange) are useful references for this space specifically because
authoring literacy matters here: customers, not Zitadel, write these
policies, and OpenFGA's DSL is the closest thing to a common language for
that audience. [ADR 031](031-permission-catalogs.md#rejected-alternatives)
covers why none of these are adopted as the *runtime engine* (sidecar
staleness risk; Melange's PostgreSQL-only compiled output). This ADR is
about reusing OpenFGA's authoring/parsing layer while keeping the runtime
contract the portable relational core from ADR 031.

## Decision

### 1. App-group catalog

The app-group catalog holds customer-owned permissions, relations, and
optional role-like bundles for apps/APIs, using the shared primitives
defined in [ADR 031 §1](031-permission-catalogs.md#1-one-model-two-catalogs).
These are emitted in tokens and introspection responses grouped by app
group / app audience. Roles remain optional: a policy that only uses direct
relations and computed permissions compiles without ever defining a role
bundle.

### 2. OpenFGA parser and profile compiler

Zitadel accepts and emits a documented OpenFGA-compatible profile for
app-group policies, but it does not run an external OpenFGA service or
store the canonical policy as opaque OpenFGA tuples.

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
| `internal/authz/compiler` | Compute relation/permission closure and produce relational catalog mutations/query-plan metadata (shared with the system catalog, see [ADR 031](031-permission-catalogs.md)). |
| `internal/authz/resolver` | Evaluate single-resource checks and produce list predicates against repository metadata (shared with the system catalog). |

**Supported profile.** The profile starts with:

- direct relations,
- relation implication / computed usersets,
- union,
- bounded tuple-to-userset through known Zitadel hierarchy edges (`project`,
  `team`, `app_group`, `app`, `user`),
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

### 3. App grants and token claims

App grants bind users or teams to apps/app groups for token claims. Token
issuance resolves these grants and embeds claims/scopes into the OIDC access
token, so the customer's app reads permission data locally from the token or
introspection response instead of calling back into Zitadel per request.
App-group permission claims can grow large; token issuance must define
audience, scope request, and claim-size limits (tracked as a follow-up).

### 4. Consistency and future external resource FGA

External resource existence *outside* Zitadel — e.g., the customer's own
expense reports, boards, or documents — is out of scope for this ADR. For
now, external permissions authorize app/API access and are exposed as
claims; Zitadel does not track or evaluate facts about resources it doesn't
own. A future customer-resource FGA API must define how external resources
are imported, versioned, and made causally fresh before Zitadel evaluates
checks against them — that is a distinct, larger consistency problem than
anything covered here.

## Consequences

### Positive

- OpenFGA remains useful for customer-facing policy literacy and future
  interoperability without forcing an external consistency boundary into
  the hot path.
- The implementation does not start with parser work: it reuses the
  maintained OpenFGA language parser and focuses local code on validation,
  compilation, storage, and query planning.

### Negative / Risks

- The OpenFGA profile is intentionally smaller than full OpenFGA; customers
  may expect unsupported constructs unless the product clearly labels the
  profile.
- The upstream OpenFGA Go language package is only a parser/transformer and
  syntactic validator for our purposes; semantic checks and performance
  bounds remain Zitadel-owned.
- App-group permission claims can grow large; token issuance must define
  audience, scope request, and claim-size limits before this ships.

## Rejected Alternatives

### Build a custom OpenFGA parser

Rejected because OpenFGA already maintains Go parser/transformer packages
for the DSL and JSON syntax. Building a parser would spend implementation
effort on grammar compatibility instead of Zitadel-specific validation,
relational compilation, and query planning.

### Adopt Melange as the compiler

Rejected for the same portability reason as the core engine decision (see
[ADR 031](031-permission-catalogs.md#rejected-alternatives)): Melange's
generated PostgreSQL functions are not a portable contract while Spanner
remains supported, even though its schema-compilation approach is a useful
reference.

## Follow-ups

1. Add the upstream OpenFGA language package and implement the IR/profile
   compiler behind `internal/authz/openfga`.
2. Define the OpenFGA profile grammar and upload diagnostics.
3. Define token claim shape, app-group grouping, and claim-size limits for
   external permissions.
4. Design relational migrations for app-group catalog tables and app
   grants.
