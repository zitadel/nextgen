-- +goose NO TRANSACTION
-- +goose Up
CREATE TABLE zitadel_nextgen.users (
    instance_id     STRING(MAX) NOT NULL,
    organization_id STRING(MAX) NOT NULL,
    id              STRING(MAX) NOT NULL CHECK (id != ''),
    created_at      TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    updated_at      TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    schema_url      STRING(MAX) NOT NULL CHECK (schema_url != ''),
) PRIMARY KEY (instance_id, id),
  INTERLEAVE IN PARENT zitadel_nextgen.instances ON DELETE CASCADE;

CREATE INDEX idx_users_organization_id
    ON zitadel_nextgen.users (instance_id, organization_id);

-- User attributes is an EAV store containing all the properties of a user.
-- This is the only table containing PII.
-- Interleaved in users to co-locate attribute rows with their parent user.
CREATE TABLE zitadel_nextgen.user_attributes (
    instance_id     STRING(MAX) NOT NULL,
    organization_id STRING(MAX) NOT NULL,
    user_id         STRING(MAX) NOT NULL,
    key             STRING(MAX) NOT NULL CHECK (key != ''),
    value           JSON        NOT NULL,
) PRIMARY KEY (instance_id, user_id, key),
  INTERLEAVE IN PARENT zitadel_nextgen.users ON DELETE CASCADE;

CREATE INDEX idx_user_attributes_scalar
    ON zitadel_nextgen.user_attributes (instance_id, key, organization_id, user_id)
    STORING (value);

CREATE INDEX idx_user_attributes_organization_id
    ON zitadel_nextgen.user_attributes (instance_id, organization_id);

-- Registry of unique user attributes. Values must be hashed with SHA-256 before storing.
CREATE TABLE zitadel_nextgen.user_unique_attributes (
    instance_id     STRING(MAX) NOT NULL,
    user_id         STRING(MAX) NOT NULL,
    organization_id STRING(MAX) NOT NULL,
    key             STRING(MAX) NOT NULL,
    value_hash      BYTES(32)   NOT NULL,
) PRIMARY KEY (instance_id, organization_id, key, value_hash),
  INTERLEAVE IN PARENT zitadel_nextgen.instances ON DELETE CASCADE;

-- +goose Down
-- +goose NO TRANSACTION
DROP TABLE IF EXISTS zitadel_nextgen.user_unique_attributes;
DROP TABLE IF EXISTS zitadel_nextgen.user_attributes;
DROP TABLE IF EXISTS zitadel_nextgen.users;
