# Project vs. Team Modeling Guide

> See [Hierarchy](../api/hierarchy.md), [Glossary](../glossary.md),
> and [ADR 024: User, Team, and Lifecycle Ownership](../../adrs/024-user-team-lifecycle-ownership.md).

This document defines the decision heuristics and worked examples indicated in [Next-Generation Platform Architecture](https://github.com/zitadel/nextgen/issues/249) for choosing between a **Project** and a **Team** in the Zitadel next-generation architecture.

## 1. Core Distinctions at a Glance

| Entity | Primary Role                                                                                                                                                                               |
| :--- |:-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Project** | The identity/auth boundary.                                                                                                                                                                |
| **Team** | A collaboration, data, and access boundary. Exists inside a project. Acts as a roster for user memberships.                                                                                |
| **User** | An identity scoped to a single Project.                                                                                                                                                    |
| **Environment** | A deployment/config variant of the same Project. Represents stages (`development`, `preview`, `production`) with different issuer/origin, runtime mode, preview URLs, and config overrides |

Zitadel infrastructure runs in a reserved **Zitadel Platform Project**.
In target architecture, claim attaches a **Customer Project** to a
**Team in the Zitadel Platform Project**.

Refer to [Hierarchy](../api/hierarchy.md) and [Glossary](../glossary.md) for a more detailed explanation of the entities and their relationships.

### Quick Decision Rule

- Use the **same Project** when dealing with the same identity/authorization universe running in another environment or under a different origin/issuer configuration.
- Use a **separate Project** when a separate issuer/session/IdP/identity boundary (e.g., isolated lifecycle and policy accountability boundaries) is needed.
- Use a **Team** when a collaboration/access boundary within one Project, allowing shared users to hold membership roles and team-scoped policy contexts is desired.

---

## 2. Decision Heuristics

To determine whether an entity should be modeled as a Project or a Team, consider the following heuristics:

### Heuristic 1: Identity Sharing

- **Rule**: If a human user must access multiple entities (e.g., workspaces, clients, merchants) using a single, unified
  credential without registering multiple times, those entities **must live within the same Project**.
- **Rationale**: User identities are scoped to a Project. An active session, credential, or profile cannot be shared
  across Project boundaries without federation (Cross-project identity behavior is yet to be resolved in [#333](https://github.com/zitadel/nextgen/issues/333)).

### Heuristic 2: Boundary Isolation

- **Rule**: Model a separate **Project** only when a separate issuer, session, IdP, identity, policy, or accountability boundary is required.
- **Rationale**: A dedicated custom domain does *not* automatically mean a new Project is needed. Domain/origin values are simply Project configuration (see [environments config](./configuration-surface.md#environments)).

### Heuristic 3: Environment vs. Project

- **Rule**: If the entity is the same identity boundary deployed to different stages, keep one **Project** and configure environments (`development`, `preview`, `production`).
- **Rationale**: Environments are deployment/config slots for one Project (see [environments config](./configuration-surface.md#environments)).
  Split into multiple Projects only when the identity or accountability state must be isolated.

### Heuristic 4: Lifecycle and Autonomy

- **Rule**: Use a **Team** when the entity is a collaboration boundary where deletion should revoke access while preserving `self`-owned users. Use a **Project** when the entity is a fully autonomous boundary that should be retired end-to-end without impacting other projects.
- **Rationale**: Teams are roster/collaboration boundaries where membership removals revoke team-scoped access;
  Projects are top-level deployment boundaries.

---

## 3. Worked Examples

> **Note on project-specific roles**:
Specifics related to user access across Customer Projects are still not finalized and are not in scope for this document.


### Case 1: Acme Inc.

- **Scenario**: Acme manages three distinct products: Acme CRM, Acme Analytics, and Acme AI. The Head of Engineering (Alice) manages all three; Bob manages only Acme AI. Products have separate staging/production setups.
- **Ownership Context**: Acme exists as a **Team** inside the platform project (`Team: Acme Account`), holding billing and subscription state. Alice and Bob are **Users** in the platform project with memberships in this team.
- **Acme's Products**: Acme CRM, Acme Analytics, and Acme AI each map to a distinct **Project**. Each Project uses fixed environments (`development`, `preview`, `production`) for deployment variants.
- **Claim Relationship**: In the target architecture, these Projects are attached to `Team: Acme Account` via claim.
- **Access Control**: Alice has owner roles across all Acme Projects. Bob is granted membership and roles solely on `Project: Acme AI`.

```text
Project: Zitadel Platform
  -> Users: Alice | Bob
  -> Team: Acme Account
    -> Memberships: Alice (account_owner) | Bob (member)
    -> claims -> Project: Acme CRM
                  -> Environments: development | preview | production
    -> claims -> Project: Acme Analytics
                  -> Environments: development | preview | production
    -> claims -> Project: Acme AI
                  -> Environments: development | preview | production
```

### Case 2: B2B SaaS (e.g., Slack)

- **Scenario**: Slack hosts Acme, Contoso, and Fabrikam workspaces. Consultant Sarah works for both Acme and Contoso with a single identity. Slack admins need global visibility.
- **Ownership Context**: Slack is represented in the platform project as `Team: Slack Account` for centralized billing and lifecycle control.
- **Customer Identity Boundary**: Slack runs its customer ecosystem as a single **Project** (`Project: Slack Workspaces`).
- **Tenants and Apps**: Slack customer workspaces are modeled as **Teams** inside Slack's Project (`Team: Acme`, `Team: Contoso`). Slack's surfaces (Web, Mobile, Admin) are modeled as **Applications** inside the Project.
- **Users and Roles**: Users in Slack's Project can hold memberships in multiple Teams (Sarah has memberships in both Acme and Contoso). Workspace admins have elevated roles in their respective Teams, while Slack operators have project-level admin roles in `Project: Slack Workspaces`.

```text
Project: Zitadel Platform
  -> Users: Slack Staff
  -> Team: Slack Account
    -> Memberships: Slack Staff (account_owner)
    -> claims -> Project: Slack Workspaces
                  -> Users: Sarah
                  -> Applications: Slack Web | Slack Mobile | Slack Admin
                  -> Teams: Acme | Contoso | Fabrikam
                     -> Memberships: Sarah (member in Team: Acme)
                     -> Memberships: Sarah (member in Team: Contoso)
```

### Case 3: B2B2C Platform (e.g., Shopify)

- **Scenario**: Shopify hosts independent merchants Nike and Adidas. Emma shops from both. Tom manages the Nike store.
- **Ownership Context**: Shopify is represented in the platform project as `Team: Shopify Account`.

**Approach A: Shared Consumer Identity**
The Shopify consumer ecosystem is one **Project** (`Project: Shopify Merchant Network`), claimed by `Team: Shopify Account`. Nike and Adidas are **Teams** inside that Project. Emma is a single **User** interacting with both Teams; Tom is a **User** with elevated roles in `Team: Nike`.

**Approach B: Isolated Merchant Identity**
If total identity isolation is required, Nike and Adidas are modeled as entirely separate **Projects** (`Project: Nike`, `Project: Adidas`), both claimed by `Team: Shopify Account` in the target architecture. Emma becomes two separate **Users** (Cross-project identity behavior is still under discussion in [#333](https://github.com/zitadel/nextgen/issues/333)).

```text
Approach A
Project: Zitadel Platform
  -> Users: Shopify Staff
  -> Team: Shopify Account
    -> Memberships: Shopify Staff (account_owner)
    -> claims -> Project: Shopify Merchant Network
                  -> Users: Emma | Tom
                  -> Teams: Nike | Adidas
                     -> Memberships: Tom (admin in Team: Nike)
```
```text
Approach B
Project: Zitadel Platform
  -> Users: Shopify Staff
  -> Team: Shopify Account
    -> Memberships: Shopify Staff (account_owner)
    -> claims -> Project: Nike
                  -> Users: Tom | Emma
    -> claims -> Project: Adidas
                  -> Users: Emma
```

### Case 4: Enterprise Workforce (e.g., Microsoft)

- **Scenario**: Microsoft manages access to M365, Azure, GitHub, and finance systems. John (Engineering) needs Azure/GitHub. Lisa (Finance) needs finance systems. Policies apply globally by default but can be overridden.
- **Ownership Context**: Microsoft is represented in the platform project as `Team: Microsoft Account`.
- **The Enterprise Boundary**: Microsoft workforce identity runs in one customer **Project** (`Project: Microsoft Workforce`), claimed by `Team: Microsoft Account` in target architecture.
- **Departments and Integrations**: Departments are **Teams** (`Team: Engineering`, `Team: Finance`). The various services (M365, Azure, GitHub) are distinct **Applications** because they are integration boundaries with unique client configurations.
- **Policies**: Central admins define global authentication policies on the Project. Teams override defaults with stricter team-level requirements if needed (for example, `Team: Finance` may configure stricter MFA).

```text
Project: Zitadel Platform
  -> Users: Microsoft IT
  -> Team: Microsoft Account
    -> Memberships: Microsoft IT (account_owner)
    -> claims -> Project: Microsoft Workforce
                  -> Users: John | Lisa
                  -> Applications: M365 | Azure | GitHub | Finance Systems
                  -> Teams: Engineering | Finance
                     -> Memberships: John (member in Team: Engineering)
                     -> Memberships: Lisa (member in Team: Finance)
```

### Case 5: Agency managing isolated customer projects (e.g., BuildStuff)

- **Scenario**: BuildStuff is a dev agency administering identity for independent customers Acme, Contoso, and Fabrikam. Agency staff Chris and Jane need admin access across setups. Customer setups must remain isolated.
- **Ownership Context**: BuildStuff is represented as `Team: BuildStuff Account` in the platform project. Agency staff are **Users** in the platform project with memberships in that Team.
- **Customers**: Acme, Contoso, and Fabrikam are modeled as entirely separate **Projects** (`Project: Acme`, `Project: Contoso`), claimed by `Team: BuildStuff Account` in the target architecture.

```text
Project: Zitadel Platform
  -> Users: Chris | Jane
  -> Team: BuildStuff Account
    -> Memberships: Chris (account_owner) | Jane (member)
    -> claims -> Project: Acme
    -> claims -> Project: Contoso
    -> claims -> Project: Fabrikam
```