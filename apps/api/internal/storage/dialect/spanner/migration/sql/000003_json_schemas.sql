-- +goose NO TRANSACTION
-- +goose Up
-- +goose StatementBegin
CREATE TABLE json_schemas (
    project_id  STRING(MAX) NOT NULL,
    url         STRING(MAX) NOT NULL,
    object_type STRING(256),
    kind        STRING(256) NOT NULL,
    created_at  TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    payload     JSON        NOT NULL,
    CONSTRAINT fk_json_schemas_project
        FOREIGN KEY (project_id)
        REFERENCES projects (id)
        ON DELETE CASCADE,
) PRIMARY KEY (project_id, url)
-- +goose StatementEnd

-- Revisions of one object type are ordered by created_at, so at most one may
-- carry a given timestamp: a collision has no determinate winner and must fail
-- loudly instead. The index is also the seek the latest-revision anti-join in
-- ListJSONSchemas uses. NULL_FILTERED because Spanner treats NULL as an
-- indexable value, so every row without an object_type would otherwise collide
-- on (project_id, NULL, created_at) — see 000016_checks_null_filtered_index.
-- +goose StatementBegin
CREATE UNIQUE NULL_FILTERED INDEX idx_json_schemas_object_type_revision
    ON json_schemas (project_id, object_type, created_at)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_json_schemas_object_type_revision
-- +goose StatementEnd

-- +goose StatementBegin
DROP TABLE IF EXISTS json_schemas
-- +goose StatementEnd
