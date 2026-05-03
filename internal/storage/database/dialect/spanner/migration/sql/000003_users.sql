-- +goose NO TRANSACTION
-- +goose Up
-- +goose StatementBegin
CREATE TABLE users (
    instance_id     STRING(MAX) NOT NULL,
    organization_id STRING(MAX) NOT NULL,
    id              STRING(MAX) NOT NULL,
    created_at      TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    updated_at      TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    schema_url      STRING(MAX) NOT NULL,
    CONSTRAINT fk_users_organization
        FOREIGN KEY (instance_id, organization_id)
        REFERENCES organizations (instance_id, id)
        ON DELETE CASCADE,
) PRIMARY KEY (instance_id, id)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_users_organization_id
    ON users (organization_id)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE user_attributes (
    instance_id     STRING(MAX) NOT NULL,
    organization_id STRING(MAX) NOT NULL,
    user_id         STRING(MAX) NOT NULL,
    key             STRING(MAX) NOT NULL,
    value           JSON        NOT NULL,
    CONSTRAINT fk_user_attributes_user
        FOREIGN KEY (instance_id, user_id)
        REFERENCES users (instance_id, id)
        ON DELETE CASCADE,
) PRIMARY KEY (instance_id, user_id, key)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_user_attributes_scalar
    ON user_attributes (key, organization_id)
    STORING (value)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_user_attributes_organization_id
    ON user_attributes (organization_id)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE user_unique_attributes (
    instance_id     STRING(MAX) NOT NULL,
    user_id         STRING(MAX) NOT NULL,
    organization_id STRING(MAX) NOT NULL,
    key             STRING(MAX) NOT NULL,
    value_hash      BYTES(32)   NOT NULL,
    CONSTRAINT fk_user_unique_attributes_user
        FOREIGN KEY (instance_id, user_id)
        REFERENCES users (instance_id, id)
        ON DELETE CASCADE,
) PRIMARY KEY (instance_id, organization_id, key, value_hash)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
DROP TABLE IF EXISTS user_unique_attributes
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS user_attributes
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS users
-- +goose StatementEnd
