-- +goose NO TRANSACTION
-- +goose Up
-- +goose StatementBegin
CREATE TABLE json_schemas (
    project_id  STRING(MAX) NOT NULL,
    url         STRING(MAX) NOT NULL,
    object_type STRING(256),
    created_at  TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    payload     JSON        NOT NULL,
    CONSTRAINT fk_json_schemas_project
        FOREIGN KEY (project_id)
        REFERENCES projects (id)
        ON DELETE CASCADE,
) PRIMARY KEY (project_id, url)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
DROP TABLE IF EXISTS json_schemas
-- +goose StatementEnd
