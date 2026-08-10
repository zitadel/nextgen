-- +goose Up
-- +goose StatementBegin
CREATE TABLE events (
    project_id          TEXT    NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    id                  TEXT    NOT NULL CHECK (id <> ''),
    event_type          TEXT    NOT NULL,
    category            TEXT    NOT NULL,
    occurred_at         INTEGER NOT NULL,
    created_at          INTEGER NOT NULL,
    team_id             TEXT,
    actor_id            TEXT,
    actor_type          TEXT,
    entity_type         TEXT,
    entity_id           TEXT,
    client_id           TEXT    NOT NULL DEFAULT '',
    token_id            TEXT    NOT NULL DEFAULT '',
    delegation_type     TEXT    NOT NULL DEFAULT '',
    delegation_id       TEXT    NOT NULL DEFAULT '',
    grantor             TEXT    NOT NULL DEFAULT '',
    fingerprint         TEXT    NOT NULL DEFAULT '',
    request_id          TEXT,
    session_id          TEXT,
    flow_id             TEXT,
    payload             TEXT    NOT NULL DEFAULT '{}',
    metadata            TEXT    NOT NULL DEFAULT '{}',
    PRIMARY KEY (project_id, id)
);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_events_project_created_at_id
    ON events (project_id, created_at, id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_events_project_created_at_id;
-- +goose StatementEnd

-- +goose StatementBegin
DROP TABLE IF EXISTS events;
-- +goose StatementEnd
