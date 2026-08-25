-- +goose Up
-- See the postgres peer (000018_sessions_sort_index.sql) for the measurements.
-- Both indexes are needed: the sort index alone regresses a selective team
-- filter (ADR 056), because the walk in created_at order has to cross most of
-- the table before it finds a page worth of matching rows.

-- +goose StatementBegin
-- Serves the default ORDER BY created_at DESC, id DESC and its ASC form: a
-- btree scans backward, so one definition covers both directions.
CREATE INDEX idx_sessions_created_at ON sessions (project_id, created_at, id);
-- +goose StatementEnd

-- +goose StatementBegin
-- Lets a selective team filter drive from team_memberships into sessions
-- instead of scanning sessions and probing membership per row.
CREATE INDEX idx_sessions_user ON sessions (project_id, user_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_sessions_user;
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_sessions_created_at;
-- +goose StatementEnd
