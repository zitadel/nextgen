-- +goose NO TRANSACTION
-- +goose Up
-- +goose StatementBegin
CREATE TABLE event_sinks (
    id          STRING(MAX) NOT NULL,
    type        STRING(MAX) NOT NULL,
    scope       STRING(MAX) NOT NULL,
    project_id  STRING(MAX),
    url         STRING(MAX),
    enabled     BOOL NOT NULL DEFAULT (TRUE)
) PRIMARY KEY (id)
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE event_deliveries (
    project_id      STRING(MAX) NOT NULL,
    event_id        STRING(MAX) NOT NULL,
    sink_id         STRING(MAX) NOT NULL,
    delivered_at    TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    CONSTRAINT fk_event_deliveries_event
        FOREIGN KEY (project_id, event_id)
        REFERENCES events (project_id, id)
        ON DELETE CASCADE
) PRIMARY KEY (project_id, event_id, sink_id)
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_event_deliveries_sink
    ON event_deliveries (sink_id, project_id, event_id)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_event_deliveries_sink
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS event_deliveries
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS event_sinks
-- +goose StatementEnd
