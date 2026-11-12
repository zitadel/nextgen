-- +goose NO TRANSACTION
-- +goose Up
-- See the postgres peer (000049_events_user_id.sql) for the column, which
-- stays empty on the events already stored, and the index. As in 000044, the
-- index covers every row and keeps created_at and id descending.
-- +goose StatementBegin
ALTER TABLE events ADD COLUMN user_id STRING(MAX)
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_events_project_user_category
    ON events (project_id, user_id, category, created_at DESC, id DESC)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_events_project_user_category
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE events DROP COLUMN user_id
-- +goose StatementEnd
