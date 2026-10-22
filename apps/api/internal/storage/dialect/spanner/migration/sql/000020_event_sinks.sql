-- +goose NO TRANSACTION
-- +goose Up
-- +goose StatementBegin
CREATE TABLE event_sinks (
    id          STRING(MAX) NOT NULL,
    type        STRING(MAX) NOT NULL,
    scope       STRING(MAX) NOT NULL,
    project_id  STRING(MAX),
    url         STRING(MAX) NOT NULL DEFAULT (''),
    enabled     BOOL NOT NULL DEFAULT (TRUE)
) PRIMARY KEY (id)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX idx_event_sinks_natural
    ON event_sinks (type, scope, url)
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE event_sink_cursors (
    sink_id          STRING(MAX) NOT NULL,
    project_id       STRING(MAX) NOT NULL,
    last_created_at  TIMESTAMP NOT NULL,
    last_event_id    STRING(MAX) NOT NULL,
    CONSTRAINT fk_event_sink_cursors_sink
        FOREIGN KEY (sink_id)
        REFERENCES event_sinks (id),
    CONSTRAINT fk_event_sink_cursors_project
        FOREIGN KEY (project_id)
        REFERENCES projects (id)
        ON DELETE CASCADE
) PRIMARY KEY (sink_id, project_id)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
DROP TABLE IF EXISTS event_sink_cursors
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_event_sinks_natural
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS event_sinks
-- +goose StatementEnd
