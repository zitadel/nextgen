-- +goose Up
-- +goose StatementBegin
-- A project's webhook (ADR 088); see the postgres migration. The key and the
-- cascade from projects are those of policies (000022). Times are unix nanos,
-- created_at stamped in Go, as everywhere else in this dialect.
CREATE TABLE webhooks (
    project_id                 TEXT    NOT NULL,
    id                         TEXT    NOT NULL,
    url                        TEXT    NOT NULL,
    description                TEXT    NOT NULL,
    -- A JSON array of strings, as every string list in this dialect.
    event_types                TEXT    NOT NULL,
    enabled                    INTEGER NOT NULL,
    secret                     TEXT    NOT NULL,
    previous_secret            TEXT,
    previous_secret_expires_at INTEGER,
    last_delivered_at          INTEGER,
    last_error_at              INTEGER,
    last_error_status          INTEGER,
    cursor_created_at          INTEGER NOT NULL,
    cursor_event_id            TEXT    NOT NULL,
    created_at                 INTEGER NOT NULL,
    PRIMARY KEY (project_id, id),
    CONSTRAINT chk_webhooks_id CHECK (id <> ''),
    CONSTRAINT fk_webhooks_project
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);
-- +goose StatementEnd

-- +goose StatementBegin
-- Webhooks list newest first by keyset; id breaks created_at ties.
CREATE INDEX idx_webhooks_project_created_at
    ON webhooks (project_id, created_at, id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_webhooks_project_created_at;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS webhooks;
-- +goose StatementEnd
