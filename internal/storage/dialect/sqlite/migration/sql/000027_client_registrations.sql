-- +goose Up
-- +goose StatementBegin
-- Clients that registered themselves through dynamic client registration; see
-- the postgres migration for why the table looks as it does. created_at and
-- expires_at are unix nanos stamped in Go, as everywhere else in this dialect.
CREATE TABLE client_registrations (
    project_id      TEXT    NOT NULL,
    id              TEXT    NOT NULL,
    metadata        TEXT    NOT NULL,
    secret_hash     TEXT,
    created_at      INTEGER NOT NULL,
    expires_at      INTEGER NOT NULL,
    PRIMARY KEY (project_id, id),
    CONSTRAINT chk_client_registrations_id CHECK (id <> ''),
    CONSTRAINT chk_client_registrations_metadata CHECK (json_type(metadata) = 'object'),
    CONSTRAINT chk_client_registrations_secret_hash CHECK (secret_hash <> ''),
    CONSTRAINT fk_client_registrations_project
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_client_registrations_project_created_at
    ON client_registrations (project_id, created_at, id);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_client_registrations_project_expires_at
    ON client_registrations (project_id, expires_at, id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_client_registrations_project_expires_at;
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_client_registrations_project_created_at;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS client_registrations;
-- +goose StatementEnd
