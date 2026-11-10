-- +goose NO TRANSACTION
-- +goose Up
-- See the postgres peer (000041_events_value_indexes.sql). As in 000044, these
-- index every row and keep created_at and id descending.
-- +goose StatementBegin
CREATE INDEX idx_events_project_type
    ON events (project_id, event_type, created_at DESC, id DESC)
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_events_project_actor_category
    ON events (project_id, actor_id, category, created_at DESC, id DESC)
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_events_project_entity_category
    ON events (project_id, entity_id, category, created_at DESC, id DESC)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_events_project_entity_category
-- +goose StatementEnd

-- +goose StatementBegin
DROP INDEX IF EXISTS idx_events_project_actor_category
-- +goose StatementEnd

-- +goose StatementBegin
DROP INDEX IF EXISTS idx_events_project_type
-- +goose StatementEnd
