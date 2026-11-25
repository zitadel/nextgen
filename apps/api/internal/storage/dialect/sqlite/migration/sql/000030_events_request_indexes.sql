-- +goose Up
-- See the postgres peer (000043_events_request_indexes.sql) for the columns,
-- which stay empty on the events already stored, and the indexes.
-- +goose StatementBegin
ALTER TABLE events ADD COLUMN operation_status TEXT;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE events ADD COLUMN status_class TEXT;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_events_project_entity_type_category
    ON events (project_id, entity_type, category, created_at, id)
    WHERE entity_type IS NOT NULL;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_events_project_operation_status
    ON events (project_id, operation_status, created_at, id)
    WHERE operation_status IS NOT NULL;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_events_project_status
    ON events (project_id, status_class, created_at, id)
    WHERE status_class IS NOT NULL;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_events_project_status;
-- +goose StatementEnd

-- +goose StatementBegin
DROP INDEX IF EXISTS idx_events_project_operation_status;
-- +goose StatementEnd

-- +goose StatementBegin
DROP INDEX IF EXISTS idx_events_project_entity_type_category;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE events DROP COLUMN status_class;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE events DROP COLUMN operation_status;
-- +goose StatementEnd
