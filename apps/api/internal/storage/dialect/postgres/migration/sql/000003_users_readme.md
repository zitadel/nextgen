<!--
    TODO(muhlemmer): this file provides usage documentation of the user EAV and partitioning.
    The contents of this file should by migrated into the operator manual of Nextgen later.
    (At the moment there's no documentation structure nor framework).
-->

# User table Scaling and Indexing Architecture

Users are stored in a a "strongly typed" EAV (Entity-Attribute-Value) system on top of JSONB, which is the best way to handle the balance between flexibility and performance in a multi-tenant system like Zitadel.

Attributes are available in a flat key space. However this results in 1-to-many rows for each user, potentially bloating the attribute table indexes. To counter this we use partitioned tables.

## Partitioning Strategy

We use **Hash Partitioning** on the instance_id column to ensure multi-tenant data locality and horizontal scalability.

### When to Partition

PostgreSQL performance and maintenance (Vacuum/Reindex) typically degrade once a table or its indexes exceed the available RAM. Our target is to keep individual partitions—including their indexes—under **30GB**.

### Row Count Guidelines

- **Users Table:** Max \~10 million rows per partition.
- **User Attributes Table:** Max \~10 million rows per partition.

### Partition Count Formula (Go Template)

When defining the modulus for the hash partitions, always use a **Power of 2** (e.g., 16, 32, 64, 128). This allows for easier manual data redistribution if needed.

1. **Identity Partitions (N):** 2 ^ ceil(log2(Total Expected Users / 10,000,000))
2. **Attribute Partitions:** (N \* A), where A is the average attributes per user, rounded to the nearest power of 2\.

### Example Partition Configurations

The following table assumes an average density of **8 attributes per user**.

| Expected User Scale | Identity Partitions | Attribute Partitions (8x) |
| :------------------ | :------------------ | :------------------------ |
| Up to 1 Million     | 1                   | 1                         |
| Up to 10 Million    | 1                   | 8                         |
| 20 Million          | 2                   | 16                        |
| 50 Million          | 8                   | 64                        |
| 100 Million         | 16                  | 128                       |
| 500 Million         | 64                  | 512                       |
| 1 Billion           | 128                 | 1024                      |

## Data Integrity and "Noise" Prevention

To ensure high-performance indexing and storage efficiency, we enforce a strict **"No Garbage"** policy via Check Constraints.

### Forbidden Values

The following values are blocked at the schema level to prevent index bloat and application-level ambiguity:

- **SQL NULL:** Prevented by NOT NULL constraints.
- **JSON Null:** The literal JSON 'null' value is forbidden.
- **Empty Containers:** Empty arrays \[\] and empty objects {} are forbidden.
- **Empty Strings:** Zero-length strings "" are forbidden.

### Sparse Data Model

We follow a sparse data model: if an attribute has no value, the row should be deleted rather than stored as an "empty" or "default" value. This keeps the table size strictly proportional to meaningful data.

## Specialized Indexing Strategy

We use a hybrid indexing approach to balance flexibility with the performance of a relational schema.

### Scalar Attributes (B-Tree)

Standard lookups for strings, numbers, and booleans are handled by B-Tree indexes.

- **Partial Indexing:** These indexes exclusively include scalar types (string, number, boolean).
- **Uniqueness:** Unique constraints (Organization or Global) are strictly limited to scalar values. Storing unique objects or arrays is disallowed as it is computationally expensive and rarely a valid requirement for identity attributes.

### Array Attributes (GIN)

For attributes storing arrays (e.g., roles, tags, or group memberships), we utilize the btree_gin extension.

- **Composite GIN:** These indexes lead with instance_id and key followed by the value. This allows the database to narrow down the search to a specific tenant/key before performing array containment searches.
- **Partial Indexing:** This index exclusively includes rows where the data type is 'array'.

### Objects (Unindexed)

JSON objects are permitted for storage but are **excluded from all indexes**. This allows for the storage of complex metadata blobs without causing index bloat or triggering B-Tree size limits.

## Maintenance Benefits

This architecture provides three primary operational advantages:

1. **Parallel Vacuuming:** PostgreSQL can trigger autovacuum workers on multiple partitions simultaneously, preventing bloat issues on high-traffic tenants.
2. **Index Locality:** By leading indexes with instance_id and partitioning by the same, the active indexes for a tenant are much more likely to remain in RAM.
3. **Efficient Deletes:** Cascade operations are confined to smaller partition files, making the reclaiming of disk space faster and less resource-intensive.
