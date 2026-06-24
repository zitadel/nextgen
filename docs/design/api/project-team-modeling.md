# Project vs. Team Modeling Guide

> See [Hierarchy](hierarchy.md)
> and [ADR 024: User, Team, and Lifecycle Ownership](../../adrs/024-user-team-lifecycle-ownership.md).

This document defines the decision heuristics and worked examples indicated in [Next-Generation Platform Architecture
](https://github.com/zitadel/nextgen/issues/249) for choosing between a **Project** and a **Team** in the Zitadel next-generation architecture.

## 1. Core Distinctions at a Glance

* **Project:** The top-level tenant and identity namespace. It owns configuration (branding, IdPs, custom domains, feature flags) and contains teams, users, apps, flows, and sessions.
* **Team:** A tenant-grouping inside a Project. It serves as a collaboration and data boundary. Depending on the context, a team might represent a B2B customer, a department, or a billing account.
* **User:** An identity scoped to a single Project. Users are attached to teams via Memberships. Removing a team always removes access derived from that membership; user deprovisioning then follows lifecycle-owner policy.

Zitadel's own infrastructure runs in a reserved **Zitadel Platform Project**. Claim attaches a **Customer Project** to a **Team in the Zitadel Platform Project.**

### Quick Decision Rule

- Choose a **Project** when you need a **hard identity boundary** (separate users, issuer/domain/IdP, sessions, or
  autonomous lifecycle).
- Choose a **Team** when you need a **collaboration and access boundary within one project** (shared users, membership roles, scoped policy overrides), or as an ownership principal (via **claim**) for customer projects under the reserved Zitadel platform project.

### What Each Entity Owns

- **Project owns**: users, teams, applications, flows, issuer/domain/IdP/session defaults.
- **Team owns**: memberships, team-scoped roles, and team-level policy override context.

## 2. Decision Heuristics

To determine whether an entity should be modeled as a Project or a Team, consider the following heuristics:

### Heuristic 1: Identity Sharing

- **Rule**: If a human user must access multiple entities (e.g., workspaces, clients, merchants) using a single, unified
  credential without registering multiple times, those entities **must live within the same Project**.
- **Rationale**: User identities are scoped to a Project. An active session, credential, or profile cannot be shared
  across Project boundaries without federation (which may create separate local users).

### Heuristic 2: Tenant Isolation vs. Brand Control

- **Rule**: If an entity requires fully isolated authentication infrastructure (for example, a dedicated custom domain
  like `auth.customer-a.com`, custom external IdPs, or separate session cookies), it **must be modeled as a Project**.
- **Rationale**: The Project owns custom domains, IdP integrations, and issuer settings. Teams can use shared project applications and enforce team-scoped access/policies, but a Team cannot become a separate issuer boundary.

### Heuristic 3: Lifecycle and Autonomy

- **Rule**: Use a **Team** when the entity is primarily a collaboration boundary and deleting it should remove team-scoped access immediately, while preserving users whose lifecycle owner is `self` (project-scoped) or another team. Use a **Project** when the entity is a fully autonomous identity boundary that should be retired end-to-end (users, apps, credentials, policies, sessions) without impacting other projects.
- **Rationale**: Teams are roster/collaboration boundaries where membership removals revoke team-scoped access;
  Projects are top-level deployment boundaries.

### Heuristic 4: Integration Boundary

- **Rule**: If the thing you are modeling is an auth-integrated system (web app, mobile app, backend service, admin
  console, third-party SaaS), model it as an **Application** inside a Project.
- **Rationale**: Applications represent protocol/client boundaries and hold integration-specific configuration, while
  Projects/Teams model identity and authorization boundaries.

### Heuristic 5: Role Differentiation

- **Rule**: Distinguish managers/admins from regular users via **role assignments on memberships**, not by creating
  separate user types.
- **Rationale**: A User is a single identity record in a Project. Capability differences come from Team-level and
  Project-level roles. 


---

## 3. Worked Examples

### Case 1: Acme Inc.

- **Scenario**: Acme manages three products: Acme CRM, Acme Analytics, and Acme AI. The Head of Engineering Alice
  manages all three; Bob manages only Acme AI. Products have separate staging/production setups.
- **Modeling**:
    - **Ownership context**: Acme exists as a **Team** inside the platform project (`Team: Acme Inc.`), which holds
      billing and subscription state.
    - Alice and Bob are **Users** in the platform project with memberships in `Team: Acme Inc.`.
    - **Acme's Products**:
        - Acme CRM, Acme Analytics, and Acme AI are deployed across multiple environments (production, staging).
        - Each environment for each product is modeled as a separate **Project** (for example: `Project: Acme AI Prod`,
          `Project: Acme AI Staging`).
        - These projects are owned by `Team: Acme Inc.` via the **Claim** flow.
        - **Access Control**: Alice has owner roles across all Acme projects. Bob is granted membership/roles only on
          Acme AI projects.

```text
Project: Zitadel Platform
  -> Team: Acme Inc.
    -> claims -> Project: Acme CRM Prod
    -> claims -> Project: Acme CRM Staging
    -> claims -> Project: Acme AI Prod
    -> claims -> Project: Acme AI Staging
```

### Case 2: B2B SaaS (e.g., Slack)

- **Scenario**: Slack hosts Acme, Contoso, and Fabrikam. Each company manages its own members and settings. Consultant
  Sarah works for both Acme and Contoso with a single identity. Slack admins need global visibility.
- **Modeling**:
    - **Ownership context**: Slack is represented in the reserved platform project as `Team: Slack Platform` for
      ownership, billing, and lifecycle control.
    - **Customer identity boundary**: Slack runs as its own customer **Project** (`Project: Slack Workspace Platform`).
    - **Tenants**: Slack customer workspaces are modeled as **Teams** inside Slack's project (`Team: Acme`,
      `Team: Contoso`, `Team: Fabrikam`).
    - **Applications**: Slack surfaces are modeled as **Applications** inside Slack's project (for example, Slack Web,
      Slack Mobile, Slack Admin Console).
    - **Users and roles**:
        - Users in Slack's project can have memberships in multiple teams (e.g., Sarah has memberships in `Team: Acme` and `Team: Contoso`).
        - Company managers/admins are users with elevated roles in their respective Teams.
        - Slack operators are users with project-level admin roles in `Project: Slack Workspace Platform`.

```text
Project: Zitadel Platform
  -> Team: Slack Platform
    -> claims -> Project: Slack Workspace Platform
                  -> Teams: Acme | Contoso | Fabrikam
                  -> Applications: Slack Web | Slack Mobile | Slack Admin Console
```

### Case 3: B2B2C Platform (e.g., Shopify)

- **Scenario**: Shopify hosts independent merchants Nike and Adidas. Emma is a consumer who shops from both. Tom is a
  store manager for Nike. Nike and Adidas must be isolated, but consumers should have a single identity across shops.
- **Modeling**:
    - **Ownership context**: Shopify is represented in the reserved platform project as `Team: Shopify Platform` for
      ownership, billing, and lifecycle control.
    - **Approach A: Shared Consumer Identity (Shopify ID Model)**:
        - The Shopify consumer ecosystem is modeled as a single **Project** (`Project: Shopify Merchant Network`).
        - `Team: Shopify Platform` claims `Project: Shopify Merchant Network`.
        - Nike and Adidas are represented as **Teams** inside that project (`Team: Nike`, `Team: Adidas`).
        - Emma is one **User** in the project and can interact with both teams using a single credential.
        - Tom is a **User** with an elevated role in `Team: Nike`, and cannot administer `Team: Adidas`.
        - **Approach B: Isolated Merchant Identity (White-Label Model)**:
            - If Nike and Adidas require complete isolation, custom domains, and private IdPs, model them as separate **Projects** (`Project: Nike`, `Project: Adidas`).
            - `Team: Shopify Platform` claims both merchant projects for centralized ownership.
            - Emma becomes two separate **Users** (one per project), with separate credentials and profiles (todo: depends on the outcome of cross-project identity management ADR).

```text
Approach A: Shared Consumer Identity
Project: Zitadel Platform
  -> Team: Shopify Platform
    -> claims -> Project: Shopify Merchant Network
                  -> Teams: Nike | Adidas

Approach B: Isolated Merchant Identity
Project: Zitadel Platform
  -> Team: Shopify Platform
    -> claims -> Project: Nike
    -> claims -> Project: Adidas
```

### Case 4: Enterprise Workforce (e.g., Microsoft)

- **Scenario**: Microsoft manages access to M365, Azure, GitHub, and finance systems. John (Engineering) needs
  Azure/GitHub. Lisa (Finance) needs finance systems. Policies apply globally by default but can be overridden.
- **Modeling**:
    - **Ownership context**: Microsoft is represented in the reserved platform project as `Team: Microsoft Enterprise`
      for ownership, billing, and lifecycle control.
    - **The Enterprise**: Microsoft's workforce runs in a single customer **Project** (`Project: Microsoft Enterprise`).
    - **Claim relationship**: `Team: Microsoft Enterprise` claims `Project: Microsoft Enterprise`.
    - **Departments**: Departments are **Teams** (`Team: Engineering`, `Team: Finance`). John belongs to Engineering;
      Lisa belongs to Finance.
    - **Applications**: M365, Azure, GitHub, and Salesforce are **Applications** because they are distinct service
      integration boundaries with their own auth/client configuration.
    - **Policies**: Central admins define global authentication policies on the Project. Teams can override defaults
      with stricter team-level requirements (for example, `Team: Finance` may configure stricter MFA).

```text
Project: Zitadel Platform
  -> Team: Microsoft Enterprise
    -> claims -> Project: Microsoft Enterprise
                  -> Teams: Engineering | Finance
                  -> Applications: M365 | Azure | GitHub | Salesforce
```

### Case 5: Agency managing customer environments (e.g., BuildStuff)

* **Scenario**: BuildStuff is a dev agency administering identity for Acme, Contoso, and Fabrikam. Agency staff Chris
  and Jane need admin access across customer setups. Customer setups must remain isolated.
* **Modeling**:
    * **Ownership context**: BuildStuff is a paying developer account, represented as a **Team** in the platform
      project (`Team: BuildStuff`). Chris and Jane are **Users** in the platform project with memberships in
      `Team: BuildStuff`.
    * **Customers**: Acme, Contoso, and Fabrikam are modeled as completely separate customer **Projects** (e.g.,
      `Project: Acme Prod`, `Project: Acme Staging`, `Project: Contoso Prod`).
    * **Access and ownership**: Membership changes in `Team: BuildStuff` affect operator access only (e.g., when an Agency staff leaves, their access to this team and all resources under it are revoked). The ownership of the customer projects remains under `Team: BuildStuff`.

```text
Project: Zitadel Platform
  -> Team: BuildStuff
    -> claims -> Project: Acme Prod
    -> claims -> Project: Contoso Prod
    -> claims -> Project: Fabrikam Prod
```


