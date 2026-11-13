-- +goose NO TRANSACTION
-- +goose Up
-- +goose StatementBegin
-- A project's webhook (ADR 090); see the postgres migration. The key, the
-- cascade from projects and the absence of interleaving are those of policies
-- (000038).
CREATE TABLE webhooks (
    project_id                 STRING(MAX) NOT NULL,
    id                         STRING(MAX) NOT NULL,
    url                        STRING(MAX) NOT NULL,
    description                STRING(MAX) NOT NULL,
    event_types                ARRAY<STRING(MAX)> NOT NULL,
    enabled                    BOOL        NOT NULL,
    secret                     STRING(MAX) NOT NULL,
    previous_secret            STRING(MAX),
    previous_secret_expires_at TIMESTAMP,
    last_delivered_at          TIMESTAMP,
    last_error_at              TIMESTAMP,
    last_error_status          INT64,
    -- A new or re-enabled webhook's cursor is the commit timestamp of the
    -- transaction that wrote it, the clock events.created_at uses (000042).
    -- A delivery writes the created_at of the event it sent, which is in the
    -- past, as this option requires of an explicit value.
    cursor_created_at          TIMESTAMP   NOT NULL OPTIONS (allow_commit_timestamp = true),
    cursor_event_id            STRING(MAX) NOT NULL,
    created_at                 TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    CONSTRAINT chk_webhooks_id CHECK (id <> ''),
    CONSTRAINT fk_webhooks_project
        FOREIGN KEY (project_id)
        REFERENCES projects (id)
        ON DELETE CASCADE,
) PRIMARY KEY (project_id, id)
-- +goose StatementEnd
-- +goose StatementBegin
-- Webhooks list newest first by keyset; DESC because Spanner has no backward
-- scan. The index also bounds what the count behind the per-project limit
-- reads, and so locks.
CREATE INDEX idx_webhooks_project_created_at
    ON webhooks (project_id, created_at DESC, id DESC)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_webhooks_project_created_at
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS webhooks
-- +goose StatementEnd
