-- +goose NO TRANSACTION
-- +goose Up
-- +goose StatementBegin
CREATE TABLE events (
    project_id          STRING(MAX) NOT NULL,
    id                  STRING(MAX) NOT NULL,
    event_type          STRING(MAX) NOT NULL,
    category            STRING(MAX) NOT NULL,
    occurred_at         TIMESTAMP   NOT NULL,
    created_at          TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    team_id             STRING(MAX),
    actor_id            STRING(MAX),
    actor_type          STRING(MAX),
    entity_type         STRING(MAX),
    entity_id           STRING(MAX),
    client_id           STRING(MAX) NOT NULL DEFAULT (''),
    token_id            STRING(MAX) NOT NULL DEFAULT (''),
    delegation_type     STRING(MAX) NOT NULL DEFAULT (''),
    delegation_id       STRING(MAX) NOT NULL DEFAULT (''),
    grantor             STRING(MAX) NOT NULL DEFAULT (''),
    fingerprint         STRING(MAX) NOT NULL DEFAULT (''),
    request_id          STRING(MAX),
    session_id          STRING(MAX),
    flow_id             STRING(MAX),
    payload             JSON        NOT NULL,
    metadata            JSON        NOT NULL
    -- project_id is opaque tenancy scope (ADR 048), not a live FK: hard-deleting
    -- a project must leave audit history (incl. project.deleted) for retention.
) PRIMARY KEY (project_id, id)
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_events_project_created_at_id
    ON events (project_id, created_at, id)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_events_project_created_at_id
-- +goose StatementEnd

-- +goose StatementBegin
DROP TABLE IF EXISTS events
-- +goose StatementEnd
