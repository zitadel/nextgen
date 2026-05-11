-- +goose NO TRANSACTION
-- +goose Up
-- +goose StatementBegin
CREATE TABLE json_schemas (
    instance_id STRING(MAX) NOT NULL,
    url         STRING(MAX) NOT NULL,
    created_at  TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    payload     JSON        NOT NULL,
    CONSTRAINT fk_json_schemas_instance
        FOREIGN KEY (instance_id)
        REFERENCES instances (id)
        ON DELETE CASCADE,
) PRIMARY KEY (instance_id, url)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
DROP TABLE IF EXISTS json_schemas
-- +goose StatementEnd
