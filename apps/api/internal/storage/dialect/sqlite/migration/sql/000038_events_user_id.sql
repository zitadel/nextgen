-- +goose Up
-- See the postgres peer (000051_events_user_id.sql) for the column, which
-- stays empty on the events already stored, and the index.
-- +goose StatementBegin
ALTER TABLE events ADD COLUMN user_id TEXT;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_events_project_user_category
    ON events (project_id, user_id, category, created_at, id)
    WHERE user_id IS NOT NULL;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_events_project_user_category;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE events DROP COLUMN user_id;
-- +goose StatementEnd
