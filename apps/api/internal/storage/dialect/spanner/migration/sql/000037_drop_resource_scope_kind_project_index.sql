-- +goose NO TRANSACTION
-- +goose Up
-- See the postgres peer (000034_drop_resource_scope_kind_project_index.sql).
-- Spanner stores the table in primary key order, so a lookup by kind and
-- project reads a key range of the table itself. The index was a second copy
-- of that range that every write had to keep up to date.
-- +goose StatementBegin
DROP INDEX idx_resource_scope_index_kind_project
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
CREATE INDEX idx_resource_scope_index_kind_project
    ON resource_scope_index (resource_kind, project_id)
-- +goose StatementEnd
