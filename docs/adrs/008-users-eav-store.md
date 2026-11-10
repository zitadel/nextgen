# ADR 008: Scalable EAV Storage for User Attributes

> **Status:** Implemented (amended 2026-11-10: the registry is folded into `user_attributes` and Postgres no longer partitions the user tables, see [Amendment](#amendment-2026-11-10-one-table-no-partitions))
> **Date:** 2026-04-26
> **Context:** Local Zitadel project configuration

## Context
Zitadel requires a storage mechanism for user attributes that supports a flexible, schema-driven Entity-Attribute-Value (EAV) model. Key requirements include:
* Scalability to 10M+ users.
* Low-latency retrieval (<2ms) for fully hydrated user objects.
* Enforcement of both Team-scoped and Global-scoped uniqueness for specific attributes (e.g., Email, Username).
* Avoidance of the "Large Table Bloat" performance degradation common in PostgreSQL.

## Decision
We will implement a decoupled, partitioned storage model using a **Header/Data/Registry** pattern.

### 1. Naming Convention
To maintain clarity within the `zitadel_nextgen` schema, we adopt canonical, descriptive naming:
* **`users`**: The primary entity header.
* **`user_attributes`**: The primary EAV data store.
* **`user_unique_attributes`**: The dedicated registry for uniqueness enforcement ("Lock Table").

### 2. Table Partitioning Strategy
Both the data store and the registry are partitioned using **Hash Partitioning**.
* **`user_attributes`** is partitioned by `(project_id, user_id)`.
* **`user_unique_attributes`** is partitioned by `(project_id, key)`.

**Rationale:** Beyond query performance, partitioning is utilized to optimize **PostgreSQL Vacuum** operations. By splitting large datasets into smaller physical files, autovacuum can process partitions independently, reducing IO-wait times and preventing table-wide bloat in high-write environments.

### 3. Data Integrity & Nuances
* **JSON Blob Validation:** To prevent "dirty data" and storage of useless metadata, a `CHECK` constraint is applied to the `value` column to prevent the insertion of empty JSON objects (`{}`) or JSON nulls.
* **Registry Usage:** We explicitly decouple uniqueness from the data store. The `user_unique_attributes` table stores binary hashes (`BYTEA`) of values to ensure the Primary Key remains dense and high-performing, even when the underlying data is a large JSON string.
* **Hash Scoping:** The registry uses a `team_id` field that is populated with the actual ID for Team-scoped uniqueness or an empty string (`''`) for Global-scoped uniqueness, allowing a single table to handle both B2B and B2C constraints.

### 4. Indexing Strategy
We employ a hybrid indexing strategy to support multi-modal data:
* **Primary Keys:** All tables use composite primary keys optimized for the most common join paths.
* **B-Tree Scalar Index:** A partial index is maintained for scalar types (string, number, boolean) to support high-speed lookups and filtering.
* **GIN Array Search:** We utilize the `btree_gin` extension to provide GIN indexes on attributes containing arrays, enabling efficient "contains" (`@>`) operations while maintaining B-Tree performance on the prefix columns (`project_id`, `key`).
* **Foreign Key Indices:** Explicit indices are maintained on `team_id` and `project_id` to support cascading deletes and multi-tenant isolation cleanup.

## Consequences

### Positive
* **Sub-millisecond Reads:** Physical co-location of data and header records results in minimal IO.
* **Maintenance Efficiency:** Localized vacuuming prevents the "Performance Cliff" at high scale.
* **Write Atomicity:** Entire user state transitions are handled in single-statement CTEs.

### Negative / Risks
* **Application Complexity:** The repository layer must manage the synchronization between the Data Store and the Registry (handled via CTEs).
* **Collision Handling:** The application must handle "Unique Violation" errors specifically for the Registry table.

## Amendment (2026-11-10): one table, no partitions

This replaces the registry and the partitioning in sections 1 to 3 (#2377).

* `user_unique_attributes` is removed. Each `user_attributes` row has nullable `value_hash` and `unique_team_id` columns. Both are set only for an `x-unique` attribute. `unique_team_id` holds the team ID for a team-scoped attribute and `''` for a project-scoped one.
* The partial unique index `idx_user_attributes_unique (project_id, key, value_hash, unique_team_id) WHERE value_hash IS NOT NULL` enforces uniqueness and serves the unique attribute lookup. The server still computes the hash.
* `users` and `user_attributes` are not partitioned. Postgres refuses a unique index on a partitioned table that leaves out a partition column, which is why the registry was a separate table. With the registry, the identifier lookup matched it with a correlated subquery, which SQLite ran once per user.
* `user_attributes.team_id` and its index are removed. No query read them.

Consequences:

* The vacuum rationale in section 2 no longer applies: autovacuum processes each user table as a whole.
* The synchronization risk in Negative / Risks is gone. One row write stores the attribute and its uniqueness claim, and a duplicate fails with a unique violation on `idx_user_attributes_unique`.
