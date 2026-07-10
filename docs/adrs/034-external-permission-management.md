# ADR 034: External Permission Management (App-Group Catalog)

> **Status:** Proposed
> **Date:** 2026-07-09
> **Context:** Authorization for customer-owned apps/APIs — app-group catalog, app grants, and token claims. Builds on the shared OpenFGA parser/profile/compiler pipeline in [ADR 032](032-permission-catalogs.md).

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

This ADR defines the **app-group catalog**: what customer-authored policies
look like, how they're grouped and evaluated, and how they become app
grants and token claims. It uses the shared OpenFGA parser/profile/compiler
pipeline defined in [ADR 032 §2](032-permission-catalogs.md#2-openfga-parser-and-profile-compiler) —
that pipeline is catalog-agnostic; this ADR covers what's specific to the
app-group audience: customer authoring literacy, app grants, and token
claims. It builds on the shared catalog model in
[ADR 032](032-permission-catalogs.md); see that document's glossary for
FGA-engine vocabulary (relation, tuple, userset, catalog, OpenFGA DSL,
profile) and
[`docs/design/glossary.md` § 5 Authorization (FGA)](../design/glossary.md#5-authorization-fga)
for cross-cutting terms (scope, principal, delegation), and
[ADR 033](033-internal-permission-management.md) for how the *other*
catalog — Zitadel's own internal resources — is authorized.

## Glossary

Terms specific to external/app-group authorization, in addition to
[ADR 032's glossary](032-permission-catalogs.md#glossary) and
[`docs/design/glossary.md` § 5](../design/glossary.md#5-authorization-fga):

| Term | Meaning |
|---|---|
| **App-group catalog** | The catalog of customer-owned permissions, relations, and optional bundles for apps/APIs; replaces legacy project authorizations. See [ADR 032 §1](032-permission-catalogs.md#1-one-model-two-catalogs). |
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
that audience. [ADR 032](032-permission-catalogs.md#rejected-alternatives)
covers why none of these are adopted as the *runtime engine* (sidecar
staleness risk; Melange's PostgreSQL-only compiled output), and
[ADR 032 §2](032-permission-catalogs.md#2-openfga-parser-and-profile-compiler)
defines the shared parser/profile/compiler pipeline both catalogs use. This
ADR is about what's specific to the app-group audience given that shared
pipeline: customer authoring literacy, app grants, and token claims.

## Decision

### 1. App-group catalog

The app-group catalog holds customer-owned permissions, relations, and
optional role-like bundles for apps/APIs, using the shared primitives
defined in [ADR 032 §1](032-permission-catalogs.md#1-one-model-two-catalogs).
These are emitted in tokens and introspection responses grouped by app
group / app audience. Roles remain optional: a policy that only uses direct
relations and computed permissions compiles without ever defining a role
bundle.

### 2. App grants and token claims

App grants bind users or teams to apps/app groups for token claims. Token
issuance resolves these grants and embeds claims/scopes into the OIDC access
token, so the customer's app reads permission data locally from the token or
introspection response instead of calling back into Zitadel per request.
App-group permission claims can grow large; token issuance must define
audience, scope request, and claim-size limits (tracked as a follow-up).

### 3. Consistency and future external resource FGA

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

### Negative / Risks

- The OpenFGA profile is intentionally smaller than full OpenFGA; customers
  may expect unsupported constructs unless the product clearly labels the
  profile.
- App-group permission claims can grow large; token issuance must define
  audience, scope request, and claim-size limits before this ships.

## Rejected Alternatives

Rejected alternatives for the shared OpenFGA parser/profile/compiler
pipeline (custom parser, Melange as compiler) are covered in
[ADR 032's Rejected Alternatives](032-permission-catalogs.md#rejected-alternatives) —
they apply to both catalogs, not just this one.

## Follow-ups

1. Define token claim shape, app-group grouping, and claim-size limits for
   external permissions.
2. Design relational migrations for app-group catalog tables and app
   grants.
