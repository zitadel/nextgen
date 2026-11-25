-- +goose NO TRANSACTION
-- +goose Up
-- See the postgres peer (000040_events_filter_indexes.sql).
--
-- Two differences from it. The indexes are not NULL_FILTERED: Spanner's
-- documentation only promises a null-filtered index to a query that says
-- IS NOT NULL, which a filter by equality does not, so these index every row.
-- And they keep created_at and id descending, the order the console reads in:
-- Spanner's documentation declares an index's keys DESC for a descending
-- read, rather than reading an ascending one backward.
-- +goose StatementBegin
CREATE INDEX idx_events_project_category
    ON events (project_id, category, created_at DESC, id DESC)
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_events_project_request
    ON events (project_id, request_id, created_at DESC, id DESC)
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_events_project_session_category
    ON events (project_id, session_id, category, created_at DESC, id DESC)
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_events_project_flow
    ON events (project_id, flow_id, created_at DESC, id DESC)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_events_project_flow
-- +goose StatementEnd

-- +goose StatementBegin
DROP INDEX IF EXISTS idx_events_project_session_category
-- +goose StatementEnd

-- +goose StatementBegin
DROP INDEX IF EXISTS idx_events_project_request
-- +goose StatementEnd

-- +goose StatementBegin
DROP INDEX IF EXISTS idx_events_project_category
-- +goose StatementEnd
