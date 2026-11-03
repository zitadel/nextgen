-- +goose NO TRANSACTION
-- +goose Up
-- +goose StatementBegin
-- Clients that registered themselves through dynamic client registration; see
-- the postgres migration for why the table looks as it does.
CREATE TABLE client_registrations (
    project_id      STRING(MAX) NOT NULL,
    id              STRING(MAX) NOT NULL,
    metadata        JSON        NOT NULL,
    secret_hash     STRING(MAX),
    created_at      TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    expires_at      TIMESTAMP   NOT NULL,
    CONSTRAINT chk_client_registrations_id CHECK (id <> ''),
    CONSTRAINT chk_client_registrations_metadata CHECK (JSON_TYPE(metadata) = 'object'),
    CONSTRAINT chk_client_registrations_secret_hash CHECK (secret_hash <> ''),
    CONSTRAINT fk_client_registrations_project
        FOREIGN KEY (project_id)
        REFERENCES projects (id)
        ON DELETE CASCADE,
) PRIMARY KEY (project_id, id)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_client_registrations_project_created_at
    ON client_registrations (project_id, created_at, id)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_client_registrations_project_expires_at
    ON client_registrations (project_id, expires_at, id)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_client_registrations_project_expires_at
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_client_registrations_project_created_at
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS client_registrations
-- +goose StatementEnd
