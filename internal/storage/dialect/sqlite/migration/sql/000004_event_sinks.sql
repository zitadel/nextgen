-- +goose Up
-- +goose StatementBegin
CREATE TABLE event_sinks (
    id          TEXT NOT NULL CHECK (id <> ''),
    type        TEXT NOT NULL,
    scope       TEXT NOT NULL,
    project_id  TEXT,
    url         TEXT,
    enabled     INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (id)
);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE event_deliveries (
    project_id      TEXT NOT NULL,
    event_id        TEXT NOT NULL,
    sink_id         TEXT NOT NULL,
    delivered_at    INTEGER NOT NULL,
    PRIMARY KEY (project_id, event_id, sink_id),
    FOREIGN KEY (project_id, event_id) REFERENCES events (project_id, id) ON DELETE CASCADE
);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_event_deliveries_sink
    ON event_deliveries (sink_id, project_id, event_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_event_deliveries_sink;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS event_deliveries;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS event_sinks;
-- +goose StatementEnd
