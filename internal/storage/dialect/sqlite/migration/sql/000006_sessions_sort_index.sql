-- +goose Up
-- See the postgres peer (000019_sessions_sort_index.sql) for the measurements.
-- Both session indexes are needed: the sort index alone regresses a selective
-- team filter (ADR 060), because the walk in created_at order has to cross most
-- of the table before it finds a page worth of matching rows.
--
-- SQLite has no CONCURRENTLY: the whole database is locked for the build. That
-- is the local / small-deployment default, where the table is small enough for
-- it not to matter.

-- +goose StatementBegin
-- Serves the default ORDER BY created_at DESC, id DESC and its ASC form: a
-- btree scans backward, so one definition covers both directions.
CREATE INDEX idx_sessions_created_at ON sessions (project_id, created_at, id);
-- +goose StatementEnd

-- +goose StatementBegin
-- Lets a selective team filter drive from users into sessions instead of
-- scanning sessions and probing the owning team per row.
CREATE INDEX idx_sessions_user ON sessions (project_id, user_id);
-- +goose StatementEnd

-- +goose StatementBegin
-- The drive side of that plan: postgres (000011) and spanner (000011) already
-- index the lifecycle owner, sqlite carried the column without one.
CREATE INDEX idx_users_lifecycle_owner_team_id ON users (project_id, lifecycle_owner_team_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_users_lifecycle_owner_team_id;
-- +goose StatementEnd

-- +goose StatementBegin
DROP INDEX IF EXISTS idx_sessions_user;
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_sessions_created_at;
-- +goose StatementEnd
