-- +goose Up
-- Projects newest first; see the postgres peer
-- (000045_projects_created_at_index.sql).

-- +goose StatementBegin
CREATE INDEX IF NOT EXISTS idx_projects_created_at
    ON projects (created_at, id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_projects_created_at;
-- +goose StatementEnd
