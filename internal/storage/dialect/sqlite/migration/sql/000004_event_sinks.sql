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
CREATE TABLE event_sink_cursors (
    sink_id          TEXT NOT NULL,
    project_id       TEXT NOT NULL,
    last_created_at  INTEGER NOT NULL,
    last_event_id    TEXT NOT NULL,
    PRIMARY KEY (sink_id, project_id),
    FOREIGN KEY (sink_id) REFERENCES event_sinks (id),
    FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS event_sink_cursors;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS event_sinks;
-- +goose StatementEnd
