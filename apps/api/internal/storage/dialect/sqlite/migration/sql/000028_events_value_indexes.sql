-- +goose Up
-- See the postgres peer (000041_events_value_indexes.sql).
-- +goose StatementBegin
CREATE INDEX idx_events_project_type
    ON events (project_id, event_type, created_at, id);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_events_project_actor_category
    ON events (project_id, actor_id, category, created_at, id)
    WHERE actor_id IS NOT NULL;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_events_project_entity_category
    ON events (project_id, entity_id, category, created_at, id)
    WHERE entity_id IS NOT NULL;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_events_project_entity_category;
-- +goose StatementEnd

-- +goose StatementBegin
DROP INDEX IF EXISTS idx_events_project_actor_category;
-- +goose StatementEnd

-- +goose StatementBegin
DROP INDEX IF EXISTS idx_events_project_type;
-- +goose StatementEnd
