-- +goose NO TRANSACTION
-- +goose Up
-- See the postgres peer (000057_events_deployment.sql) for the columns, which
-- stay empty on the events already stored, and the indexes. As in 000044, an
-- index covers every row and keeps created_at and id descending.
-- +goose StatementBegin
ALTER TABLE events ADD COLUMN deployment_id STRING(MAX)
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE events ADD COLUMN release_id STRING(MAX)
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE events ADD COLUMN target STRING(MAX)
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_events_project_release
    ON events (project_id, release_id, created_at DESC, id DESC)
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_events_project_deployment
    ON events (project_id, deployment_id, created_at DESC, id DESC)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_events_project_deployment
-- +goose StatementEnd

-- +goose StatementBegin
DROP INDEX IF EXISTS idx_events_project_release
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE events DROP COLUMN target
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE events DROP COLUMN release_id
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE events DROP COLUMN deployment_id
-- +goose StatementEnd
