-- +goose Up
-- +goose NO TRANSACTION

-- users is interleaved in instances for physical co-location and cascade
-- delete. The cross-tree FK to organizations is a separate constraint
-- (Spanner supports FK + INTERLEAVE targeting different parents).
-- +goose StatementBegin
CREATE TABLE users (
    instance_id     STRING(MAX) NOT NULL,
    organization_id STRING(MAX) NOT NULL CHECK (organization_id != ''),
    id              STRING(MAX) NOT NULL CHECK (id != ''),
    created_at      TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    updated_at      TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    schema_url      STRING(MAX) NOT NULL CHECK (schema_url != ''),
    CONSTRAINT fk_users_org
        FOREIGN KEY (instance_id, organization_id)
        REFERENCES organizations (instance_id, id)
        ON DELETE CASCADE,
) PRIMARY KEY (instance_id, id),
  INTERLEAVE IN PARENT instances ON DELETE CASCADE;
-- +goose StatementEnd

CREATE INDEX idx_users_organization_id ON users (instance_id, organization_id);

-- user_attributes is interleaved in users for cascade-delete and locality.
-- Spanner's JSON type replaces Postgres JSONB.
-- The jsonb_typeof-based CHECK constraint from Postgres cannot be expressed
-- in GoogleSQL; scalar/array type enforcement is handled at the application
-- layer instead.
-- Spanner has no GIN indexes; the array-search index is omitted — use a
-- Spanner SEARCH index or JSON_VALUE extraction if that query pattern
-- is needed.
-- +goose StatementBegin
CREATE TABLE user_attributes (
    instance_id     STRING(MAX) NOT NULL,
    organization_id STRING(MAX) NOT NULL,
    user_id         STRING(MAX) NOT NULL,
    key             STRING(MAX) NOT NULL CHECK (key != ''),
    value           JSON        NOT NULL,
    org_unique      BOOL        NOT NULL DEFAULT (false),
    global_unique   BOOL        NOT NULL DEFAULT (false),
) PRIMARY KEY (instance_id, user_id, key),
  INTERLEAVE IN PARENT users ON DELETE CASCADE;
-- +goose StatementEnd

-- Org-scoped uniqueness; STORING avoids a back-join on attribute lookups.
CREATE UNIQUE INDEX idx_user_attributes_org_unique
    ON user_attributes (instance_id, organization_id, key, value, org_unique)
    STORING (user_id);

-- Global uniqueness index.
CREATE UNIQUE INDEX idx_user_attributes_global_unique
    ON user_attributes (instance_id, key, value, global_unique)
    STORING (user_id);

-- General scalar-value lookup.
CREATE INDEX idx_user_attributes_scalar
    ON user_attributes (instance_id, key, value)
    STORING (user_id);

-- +goose Down
-- +goose NO TRANSACTION
-- Child tables must be dropped before their interleave parent.
DROP TABLE user_attributes;
DROP TABLE users;
