-- +goose NO TRANSACTION
-- +goose Up
-- See the postgres peer (000019_sessions_sort_index.sql) for the measurements.
-- Both indexes are needed: the sort index alone regresses a selective team
-- filter (ADR 060), because the walk in created_at order has to cross most of
-- the table before it finds a page worth of matching rows.
--
-- No CONCURRENTLY equivalent is needed: Spanner backfills a new index as a
-- long-running background operation and keeps the table writable throughout,
-- which is what the postgres peer has to ask for explicitly.
--
-- Neither index is NULL_FILTERED. user_id is NULL on anonymous sessions, and
-- ListSessions can both sort by user_id and filter user_id IS NULL, so those
-- rows have to stay indexed. GoogleSQL orders NULLs first ascending, which is
-- the NULLS FIRST / NULLS LAST pair the compiler assumes.

-- +goose StatementBegin
CREATE INDEX idx_sessions_created_at
    ON sessions (project_id, created_at, id)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_sessions_user
    ON sessions (project_id, user_id)
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_sessions_user
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_sessions_created_at
-- +goose StatementEnd
