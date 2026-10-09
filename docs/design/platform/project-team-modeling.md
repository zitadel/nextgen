# Project vs. Team Modeling Guide

> **Status:** Draft guidance
> **See also:** [Hierarchy](../api/hierarchy.md), [Glossary](../glossary.md),
> [Claim Flow](claim-flow.md), and
> [ADR 024: User, Team, and Lifecycle Ownership](../../adrs/024-user-team-lifecycle-ownership.md).
>
> **Scope:** This guide explains when to model something as a **Project** or
> a **Team**. It does not define cross-project operator access, global human
> identity, project grants, or consultant/staff collaboration across Projects.
> Those topics are tracked in
> [#333](https://github.com/zitadel/nextgen/issues/333).

Use this document when a real-world concept could be either a Project or a
Team: a product, workspace, merchant, department, agency customer, or paying
account.

## The Short Rule

Use a **Project** when you need a separate identity, authentication, or
authorization boundary.

Use a **Team** when you need a collaboration group, roster, or access boundary
inside one Project.

Use an **Environment** when the same Project runs in development, preview, or
production with different config.

In one sentence:

> Project = identity/auth boundary. Team = collaboration/group boundary inside
> that boundary. Environment = config/deployment variant of the same boundary.

## Decision Table

| Question | Model |
|---|---|
| Is this the same users, sessions, IdPs, apps, policies, and auth boundary running in dev, preview, or production? | Same **Project**, different **Environment**. |
| Is this the same identity universe served from another issuer, origin, or custom domain? | Same **Project**, different Environment issuer/origin config. |
| Do users need one credential and one profile across workspaces, merchants, departments, or other groups? | Same **Project**, multiple **Teams**. |
| Does each entity need isolated users, sessions, IdPs, apps, grants, policies, or lifecycle/accountability state? | Separate **Projects**. |
| Is this the account or workspace that owns Projects in this Zitadel deployment? | A **Team in the platform Project**. |
| Is this a customer workspace, merchant, department, or collaboration group inside an application? | A **Team in the customer Project**. |

## Mental Model

Every Zitadel deployment has a reserved **platform Project**. This is true for
cloud and self-hosted deployments. The platform Project is what lets Zitadel
create and attach ownership to customer Projects without introducing a separate
organization resource.

In this guide, "customer Project" means a non-platform Project owned by an
account or workspace in the platform Project. It does not mean "cloud-only".

There is no separate "organization" resource in the next-generation model. The
same Team resource appears in two common contexts:

- A **Team in the platform Project** represents an owning account or workspace
  in this Zitadel deployment. In cloud that may be a customer account. In
  self-hosted deployments it may be the operator's default team or another
  account-like grouping. It can own customer Projects.
- A **Team in a customer Project** represents a workspace, merchant, department,
  or other customer-defined group inside that Project.

The context matters more than the word "Team".

Assigning ownership attaches a customer Project to a Team in the platform
Project for accountability, recovery, governance, and, in cloud, billing. The
CLI's `zitadel claim` flow is one way a newly created Project gets that owner.
Ownership does **not** by itself define how every human in the platform Team can
administer every owned Project. Cross-project operator access is still out of
scope for this guide and belongs to [#333](https://github.com/zitadel/nextgen/issues/333).

## Definitions

### Project

A Project is the top-level identity/auth boundary. It contains users, teams,
memberships, apps, IdPs, sessions, flows, policies, roles/grants, branding, and
declared issuers for one identity space.

Choose a separate Project when the boundary should be independently owned,
isolated, configured, retired, audited, or recovered.

### Team

A Team groups users and resources inside a Project. It gives the Project a
roster, membership roles, team-scoped policy context, and a boundary for
collaboration or customer data.

Choose a Team when the users should remain in the same identity universe but
need scoped access to a workspace, department, merchant, customer group, or
account.

### Environment

An Environment is a config/deployment slot for the same Project. The fixed
environment names are `development`, `preview`, and `production`.

Environments can have different issuer/origin declarations, runtime mode,
preview URLs, and config overrides. They do not create a separate identity
boundary by themselves.

### User

A User is scoped to exactly one Project. A User may have zero, one, or many Team
memberships inside that Project. A Team membership is not the same thing as
identity lifecycle ownership; [ADR 024](../../adrs/024-user-team-lifecycle-ownership.md) defines that split.

## Decision Rules

### 1. Start with identity sharing

If a human should access multiple entities with one credential, one session, and
one profile, those entities need to live inside the same Project.

Use Teams to separate their access inside that Project.

If the same human should have separate credentials, sessions, policy state, or
accountability in each entity, separate Projects may be correct. Cross-project
identity linking is not decided yet; see [#333](https://github.com/zitadel/nextgen/issues/333).

### 2. Do not split Projects for environments unless isolation is intentional

Staging and production are usually Environments of the same Project.

Split into separate Projects only when staging and production intentionally need
isolation: separate users, credentials, sessions, IdPs, apps, roles, grants,
policies, lifecycle, or accountability.

Some customers may want completely separated environments. That is valid, but
the reason is the desired isolation, not the fact that the environment is named
staging or production.

### 3. Treat domains as Environment config

A custom domain, issuer, preview URL, or origin is config on an Environment.
It is not a reason to create a new Project.

If a customer wants a separate Project, the reason should be isolated users,
credentials, sessions, IdPs, apps, roles, grants, policies, lifecycle, or
accountability. The domain just points at that chosen boundary.

### 4. Use Teams to group access inside one Project

Teams are the right model when users need scoped access to a group inside one
identity universe:

- Slack workspaces
- Shopify-style merchants in a shared consumer network
- enterprise departments
- customer workspaces in a B2B SaaS product
- owning account/workspace groups in the platform Project

### 5. Keep ownership separate from access control

Ownership answers: "Which platform Team is accountable for this Project?"

Access control answers: "Which principal can do which action in this Project?"

Do not assume that a Team owning a Project automatically decides every human
operator's admin rights. That is a separate authorization model.

## Common Mistakes

| Mistake | Better model |
|---|---|
| `Project: Acme AI Staging` and `Project: Acme AI Production` by default | `Project: Acme AI` with `development`, `preview`, and `production` Environments. |
| `Project: acme.com` only because Acme has a custom domain | Same Project with Acme's issuer/origin configured. |
| Treating a Team in the platform Project and a Team in a customer Project as different resource kinds | Same resource kind, different Project context. |
| Assuming ownership defines all admin permissions across owned Projects | Ownership defines accountability. Cross-project access is separate and still tracked in [#333](https://github.com/zitadel/nextgen/issues/333). |
| Treating Team membership as user lifecycle ownership | Membership controls participation/access. Lifecycle ownership is explicit policy from [ADR 024](../../adrs/024-user-team-lifecycle-ownership.md). |

## Examples

These examples show how to choose the model. They intentionally do not finalize
cross-project operator access.

### Case 1: Acme has multiple product streams

Acme is one company with several product streams: CRM, Analytics, and AI.

Decision question: are those product streams separate identity/auth boundaries,
or are they product areas inside one shared identity universe?

If each stream has independent users, apps, IdPs, policies, lifecycle, or
accountability, use separate Projects owned by the same platform Team:

```text
Project: Zitadel Platform
  -> Team: Acme Account
    -> owns -> Project: Acme CRM
                  -> Environments: development | preview | production
    -> owns -> Project: Acme Analytics
                  -> Environments: development | preview | production
    -> owns -> Project: Acme AI
                  -> Environments: development | preview | production
```

If Acme wants one shared customer or workforce identity across all streams,
model the streams as Apps, app groups, or product areas inside one Project
instead:

```text
Project: Zitadel Platform
  -> Team: Acme Account
    -> owns -> Project: Acme Product Suite
                  -> Apps: CRM | Analytics | AI
                  -> Teams: Sales | Engineering | Finance
                  -> Environments: development | preview | production
```

Alice managing all products and Bob managing only Acme AI is an access-control
requirement. If the products are separate Projects, the cross-project admin
mechanism is intentionally left to [#333](https://github.com/zitadel/nextgen/issues/333).

### Case 2: B2B SaaS workspaces

Decision question: should a consultant use one identity across multiple
customer workspaces?

For a Slack-style product, yes. Sarah should access Acme and Contoso with one
identity, so the product's customer ecosystem is one Project. Customer
workspaces are Teams inside that Project.

```text
Project: Zitadel Platform
  -> Team: Slack Account
    -> owns -> Project: Slack Workspaces
                  -> Users: Sarah | Slack Staff
                  -> Apps: Slack Web | Slack Mobile | Slack Admin
                  -> Teams: Acme | Contoso | Fabrikam
                     -> Memberships: Sarah in Acme
                     -> Memberships: Sarah in Contoso
```

Workspace admins are Team-scoped roles. Slack-wide admins are project-level
roles inside `Project: Slack Workspaces`.

### Case 3: B2B2C merchant platform

Decision question: should consumers have one identity across merchants?

For a Shopify-style product, usually yes. If consumers should have one identity
across merchants, use one Project and model merchants as Teams:

```text
Project: Zitadel Platform
  -> Team: Shopify Account
    -> owns -> Project: Shopify Merchant Network
                  -> Users: Emma | Tom | Shopify Staff
                  -> Apps: Storefront | Merchant Portal | Admin Console
                  -> Teams: Nike | Adidas
                     -> Memberships: Tom as admin in Nike
```

Emma is one User in the Project and can interact with both merchants.

If Nike and Adidas require total identity isolation, use separate Projects:

```text
Project: Zitadel Platform
  -> Team: Shopify Account
    -> owns -> Project: Nike
                  -> Users: Emma | Tom
    -> owns -> Project: Adidas
                  -> Users: Emma
```

In that isolated model, Emma is represented as two project-scoped Users.
Whether those users can be linked into one global human identity is unresolved
and belongs to [#333](https://github.com/zitadel/nextgen/issues/333).

### Case 4: Enterprise workforce

Decision question: is this one workforce identity system?

For a Microsoft-style workforce setup, usually yes. The enterprise workforce
belongs in one Project. Departments are Teams, and services are Apps.

```text
Project: Zitadel Platform
  -> Team: Microsoft Account
    -> owns -> Project: Microsoft Workforce
                  -> Users: John | Lisa | Microsoft IT
                  -> Apps: M365 | Azure | GitHub | Finance Systems
                  -> Teams: Engineering | Finance
                     -> Memberships: John in Engineering
                     -> Memberships: Lisa in Finance
```

Central IT administrators should be modeled as principals with project-level
roles inside `Project: Microsoft Workforce`, unless a future cross-project
operator model decides otherwise.

### Case 5: Agency managing isolated customer projects

Decision question: do agency customers need hard isolation from each other?

For an agency such as BuildStuff, yes. Acme, Contoso, and Fabrikam are
independent customers with their own apps, users, policies, domains, and
lifecycle. They should be separate Projects.

```text
Project: Zitadel Platform
  -> Team: BuildStuff Account
    -> owns -> Project: Acme
    -> owns -> Project: Contoso
    -> owns -> Project: Fabrikam
```

This models ownership/accountability: BuildStuff's platform Team owns the
customer Projects.

It does not finalize how Chris and Jane administer all three Projects. Until the
cross-project identity and collaboration ADR lands, that access must be modeled
explicitly per Project or called out as TBD.

## Out of Scope

This guide does not define:

- how one human identity is linked across multiple Projects
- how platform Team members receive admin access across owned Projects
- staff/support access to customer Projects
- agency/consultant access delegation across isolated Projects
- project transfer or Team merge semantics beyond Project ownership

Those decisions belong to the cross-project identity and collaboration work in
[#333](https://github.com/zitadel/nextgen/issues/333).

## Summary

When the model feels ambiguous, ask these questions in order:

1. Do these entities share one identity/auth boundary?
2. Do users need one credential and profile across them?
3. Is the difference only environment, issuer, origin, or domain config?
4. Is this a group that needs scoped access inside one Project?
5. Is this a hard isolation/accountability boundary between Projects?

The answers usually choose the resource:

- Same identity boundary: one Project.
- Scoped collaboration inside that boundary: Teams.
- Dev/preview/prod variants: Environments.
- Separate identity/accountability boundary: separate Projects.
- Ownership of customer Projects by an account/workspace: attach them to a Team
  in the platform Project.
