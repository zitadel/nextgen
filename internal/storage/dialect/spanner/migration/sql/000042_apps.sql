-- +goose NO TRANSACTION
-- +goose Up
-- +goose StatementBegin
-- An app is revisioned like an identity provider connection; see the postgres
-- migration for the tables and why each exists.
CREATE TABLE apps (
    project_id          STRING(MAX) NOT NULL,
    id                  STRING(MAX) NOT NULL,
    slug                STRING(MAX) NOT NULL,
    source              STRING(MAX) NOT NULL,
    created_at          TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    CONSTRAINT chk_apps_id CHECK (id <> ''),
    CONSTRAINT chk_apps_slug CHECK (slug <> ''),
    CONSTRAINT chk_apps_source CHECK (source IN ('declared', 'registered')),
    CONSTRAINT fk_apps_project
        FOREIGN KEY (project_id)
        REFERENCES projects (id)
        ON DELETE CASCADE,
) PRIMARY KEY (project_id, id)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX uq_apps_project_slug
    ON apps (project_id, slug)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_apps_project_created_at
    ON apps (project_id, created_at, id)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE app_revisions (
    project_id      STRING(MAX) NOT NULL,
    id              STRING(MAX) NOT NULL,
    app_id          STRING(MAX) NOT NULL,
    document        JSON        NOT NULL,
    created_at      TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    CONSTRAINT chk_app_revisions_id CHECK (id <> ''),
    CONSTRAINT chk_app_revisions_document CHECK (JSON_TYPE(document) = 'object'),
    CONSTRAINT fk_app_revisions_app
        FOREIGN KEY (project_id, app_id)
        REFERENCES apps (project_id, id)
        ON DELETE CASCADE,
) PRIMARY KEY (project_id, id)
-- +goose StatementEnd
-- +goose StatementBegin
-- created_at DESC: Spanner serves the newest-first history from an index only
-- when the declared order matches; see the connection migration.
CREATE UNIQUE INDEX uq_app_revisions_app_created_at
    ON app_revisions (project_id, app_id, created_at DESC)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE app_clients (
    project_id      STRING(MAX) NOT NULL,
    id              STRING(MAX) NOT NULL,
    app_id          STRING(MAX) NOT NULL,
    slug            STRING(MAX) NOT NULL,
    client_id       STRING(MAX) NOT NULL,
    created_at      TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    CONSTRAINT chk_app_clients_id CHECK (id <> ''),
    CONSTRAINT chk_app_clients_slug CHECK (slug <> ''),
    CONSTRAINT chk_app_clients_client_id CHECK (client_id <> ''),
    CONSTRAINT fk_app_clients_app
        FOREIGN KEY (project_id, app_id)
        REFERENCES apps (project_id, id)
        ON DELETE CASCADE,
) PRIMARY KEY (project_id, id)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX uq_app_clients_project_client_id
    ON app_clients (project_id, client_id)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX uq_app_clients_app_slug
    ON app_clients (project_id, app_id, slug)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE app_api_identifiers (
    project_id      STRING(MAX) NOT NULL,
    identifier      STRING(MAX) NOT NULL,
    app_id          STRING(MAX) NOT NULL,
    created_at      TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    CONSTRAINT chk_app_api_identifiers_identifier CHECK (identifier <> ''),
    CONSTRAINT fk_app_api_identifiers_app
        FOREIGN KEY (project_id, app_id)
        REFERENCES apps (project_id, id)
        ON DELETE CASCADE,
) PRIMARY KEY (project_id, identifier)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_app_api_identifiers_app
    ON app_api_identifiers (project_id, app_id)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE app_client_secrets (
    project_id      STRING(MAX) NOT NULL,
    id              STRING(MAX) NOT NULL,
    client_row_id   STRING(MAX) NOT NULL,
    encoded_hash    STRING(MAX) NOT NULL,
    created_at      TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    CONSTRAINT chk_app_client_secrets_id CHECK (id <> ''),
    CONSTRAINT chk_app_client_secrets_hash CHECK (encoded_hash <> ''),
    CONSTRAINT fk_app_client_secrets_client
        FOREIGN KEY (project_id, client_row_id)
        REFERENCES app_clients (project_id, id)
        ON DELETE CASCADE,
) PRIMARY KEY (project_id, id)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_app_client_secrets_client
    ON app_client_secrets (project_id, client_row_id)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_app_client_secrets_client
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS app_client_secrets
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_app_api_identifiers_app
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS app_api_identifiers
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS uq_app_clients_app_slug
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS uq_app_clients_project_client_id
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS app_clients
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS uq_app_revisions_app_created_at
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS app_revisions
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_apps_project_created_at
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS uq_apps_project_slug
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS apps
-- +goose StatementEnd
