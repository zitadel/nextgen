-- +goose NO TRANSACTION
-- +goose Up
-- Projects newest first; see the postgres peer
-- (000045_projects_created_at_index.sql). Descending keys, because newest
-- first is the order both readers ask for, and Spanner reads an index fastest
-- in its own order.

-- +goose StatementBegin
CREATE INDEX idx_projects_created_at
    ON projects (created_at DESC, id DESC)
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX idx_projects_created_at
-- +goose StatementEnd
