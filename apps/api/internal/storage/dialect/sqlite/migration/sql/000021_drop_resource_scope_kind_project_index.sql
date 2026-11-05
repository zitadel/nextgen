-- +goose Up
-- See the postgres peer (000034_drop_resource_scope_kind_project_index.sql).
-- SQLite backs the composite primary key with its own unique index on
-- (resource_kind, project_id, resource_id), which serves the same lookups.
-- +goose StatementBegin
DROP INDEX idx_resource_scope_index_kind_project;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
CREATE INDEX idx_resource_scope_index_kind_project
    ON resource_scope_index (resource_kind, project_id);
-- +goose StatementEnd
