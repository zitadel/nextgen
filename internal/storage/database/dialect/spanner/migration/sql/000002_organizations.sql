-- +goose NO TRANSACTION
-- +goose Up
-- +goose StatementBegin
CREATE TABLE organizations (
    instance_id STRING(MAX) NOT NULL,
    id          STRING(MAX) NOT NULL,
    created_at  TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    updated_at  TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    CONSTRAINT fk_organizations_instance
        FOREIGN KEY (instance_id)
        REFERENCES instances (id)
        ON DELETE CASCADE,
) PRIMARY KEY (instance_id, id)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
DROP TABLE IF EXISTS organizations
-- +goose StatementEnd
