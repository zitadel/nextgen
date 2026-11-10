-- +goose Up
-- See the postgres peer (000040_events_filter_indexes.sql).
-- +goose StatementBegin
CREATE INDEX idx_events_project_category
    ON events (project_id, category, created_at, id);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_events_project_request
    ON events (project_id, request_id, created_at, id)
    WHERE request_id IS NOT NULL;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_events_project_session_category
    ON events (project_id, session_id, category, created_at, id)
    WHERE session_id IS NOT NULL;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_events_project_flow
    ON events (project_id, flow_id, created_at, id)
    WHERE flow_id IS NOT NULL;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_events_project_flow;
-- +goose StatementEnd

-- +goose StatementBegin
DROP INDEX IF EXISTS idx_events_project_session_category;
-- +goose StatementEnd

-- +goose StatementBegin
DROP INDEX IF EXISTS idx_events_project_request;
-- +goose StatementEnd

-- +goose StatementBegin
DROP INDEX IF EXISTS idx_events_project_category;
-- +goose StatementEnd
