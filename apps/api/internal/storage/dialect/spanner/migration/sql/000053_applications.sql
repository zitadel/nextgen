-- +goose NO TRANSACTION
-- +goose Up
-- +goose StatementBegin
-- A registered application; see the postgres migration.
CREATE TABLE applications (
    project_id          STRING(MAX) NOT NULL,
    id                  STRING(MAX) NOT NULL,
    slug                STRING(MAX) NOT NULL,
    created_at          TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    CONSTRAINT chk_applications_id CHECK (id <> ''),
    CONSTRAINT chk_applications_slug CHECK (slug <> ''),
    CONSTRAINT fk_applications_project
        FOREIGN KEY (project_id)
        REFERENCES projects (id)
        ON DELETE CASCADE,
) PRIMARY KEY (project_id, id)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX uq_applications_project_slug
    ON applications (project_id, slug)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE application_revisions (
    project_id      STRING(MAX) NOT NULL,
    id              STRING(MAX) NOT NULL,
    application_id  STRING(MAX) NOT NULL,
    document        JSON        NOT NULL,
    created_at      TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    CONSTRAINT chk_application_revisions_id CHECK (id <> ''),
    CONSTRAINT chk_application_revisions_document CHECK (JSON_TYPE(document) = 'object'),
    CONSTRAINT fk_application_revisions_application
        FOREIGN KEY (project_id, application_id)
        REFERENCES applications (project_id, id)
        ON DELETE CASCADE,
) PRIMARY KEY (project_id, id)
-- +goose StatementEnd
-- +goose StatementBegin
-- DESC for the newest-revision lookup; see 000025_idp_connections.sql.
CREATE UNIQUE INDEX uq_application_revisions_application_created_at
    ON application_revisions (project_id, application_id, created_at DESC)
-- +goose StatementEnd
-- +goose StatementBegin
-- See the postgres migration for why no row is deleted.
CREATE TABLE application_clients (
    project_id      STRING(MAX) NOT NULL,
    id              STRING(MAX) NOT NULL,
    application_id  STRING(MAX) NOT NULL,
    slug            STRING(MAX) NOT NULL,
    client_id       STRING(MAX) NOT NULL,
    created_at      TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    CONSTRAINT chk_application_clients_id CHECK (id <> ''),
    CONSTRAINT chk_application_clients_slug CHECK (slug <> ''),
    CONSTRAINT chk_application_clients_client_id CHECK (client_id <> ''),
    CONSTRAINT fk_application_clients_application
        FOREIGN KEY (project_id, application_id)
        REFERENCES applications (project_id, id)
        ON DELETE CASCADE,
) PRIMARY KEY (project_id, id)
-- +goose StatementEnd
-- +goose StatementBegin
-- See the postgres migration for why a write here can trip one of three
-- constraints. STORING keeps the by-client_id lookup to one index read.
CREATE UNIQUE INDEX uq_application_clients_project_client_id
    ON application_clients (project_id, client_id)
    STORING (application_id, slug, created_at)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX uq_application_clients_application_slug
    ON application_clients (project_id, application_id, slug)
-- +goose StatementEnd
-- +goose StatementBegin
-- See the postgres migration for why secrets have their own table.
CREATE TABLE application_client_secrets (
    project_id             STRING(MAX) NOT NULL,
    id                     STRING(MAX) NOT NULL,
    application_client_id  STRING(MAX) NOT NULL,
    secret_hash            STRING(MAX) NOT NULL,
    created_at             TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    CONSTRAINT chk_application_client_secrets_id CHECK (id <> ''),
    CONSTRAINT fk_application_client_secrets_client
        FOREIGN KEY (project_id, application_client_id)
        REFERENCES application_clients (project_id, id)
        ON DELETE CASCADE,
) PRIMARY KEY (project_id, id)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_application_client_secrets_client
    ON application_client_secrets (project_id, application_client_id, created_at)
    STORING (secret_hash)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_application_client_secrets_client
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS application_client_secrets
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS uq_application_clients_application_slug
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS uq_application_clients_project_client_id
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS application_clients
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS uq_application_revisions_application_created_at
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS application_revisions
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS uq_applications_project_slug
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS applications
-- +goose StatementEnd
