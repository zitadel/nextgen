# ADR 011: Project Layout and Responsibilities

> **Status:** Proposed
> **Date:** 2026-05-11
> **Context:** System architecture and package organization

## Decision

We adopt a **Modular Hexagonal Architecture** using a flat layout within the `internal/` directory. All dependencies must flow strictly **inward** toward the Domain. Infrastructure details, specifically database executors and transaction types, must be abstracted or propagated via `context.Context` to keep Domain interfaces pure.

## Context

As we scale to support multiple identity and provisioning protocols (**REST, SCIM, SAML, OIDC**), we must prevent "Package Spaghetti." Business logic, database queries, and protocol-specific handling (XML/JSON) must remain decoupled. This structure ensures that adding a new "front door" (like a SAML IDP) or changing a "back door" (like the database driver) does not require a rewrite of core business rules.

### Project Layout Map

```text
├── internal/
│   ├── api/               # ADAPTERS: REST (ogen), SCIM, SAML
│   ├── service/           # ORCHESTRATION: Use-cases & Workflows
│   ├── domain/            # CORE: Entities, Repo Interfaces, Errors
│   └── storage/         
│       └── database/      # INFRASTRUCTURE: DB Implementations
│           └── repository # Postgres/SQL logic
```

### Layer Responsibility Table

| Layer       | Logical Role   | Responsibility                                                      | Allowed Imports              |
|:------------|:---------------|:--------------------------------------------------------------------|:-----------------------------|
| **api**     | Adapters       | Translates JSON/XML into Service calls; handles HTTP/SAML statuses. | `service`, `domain`          |
| **service** | Orchestration  | Manages business workflows and transaction boundaries.              | `domain`                     |
| **domain**  | Core           | Owns entities, business invariants, and repository interfaces.      | utilities                    |
| **storage** | Infrastructure | Implements repository interfaces and handles data reconstitution.   | `domain`, `storage/database` |

## Consequences

- **Strict Encapsulation:** The `api` layer is strictly forbidden from importing `storage`. All data access must be mediated by a `service` to ensure business invariants are enforced.
- **Infrastructure Ignorance:** Interfaces defined in `internal/domain` must not import packages from `internal/storage`. Infrastructure-specific types (e.g., `database.QueryExecutor` or `database.Change`) must not appear in Domain method signatures.
- **Transaction Management:** Transactions are managed at the **Service** level. To maintain architectural purity, SQL executors/transactions are propagated via `context.Context` rather than being passed explicitly through Domain interfaces.
- **Error Mapping:** Errors are defined in `domain` as `Error` types owning a public `code` and `description`. The `api` layer translates these into protocol-specific statuses (HTTP, SCIM types, or SAML StatusCodes).
- **Persistence Ignorance:** IDs are generated in the `domain` (prefixed ULIDs) and entities are "reconstituted" from rows within `storage`, ensuring the `service` remains unaware of database implementation details.
- **Automated Enforcement:** We use `go-arch-lint` to prevent dependency violations. The linter will fail builds if `domain` imports `api`, `service` or any other not-allowed package.
- **Reference Implementation:** See `internal/service/auth_attempt.go` for the reference on service-to-domain interaction and `.go-arch-lint.yml` for the dependency rules.