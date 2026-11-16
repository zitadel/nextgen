-- +goose Up
-- +goose StatementBegin
-- A registered application; see the postgres migration. created_at is unix
-- nanos stamped in Go, as everywhere else in this dialect.
CREATE TABLE applications (
    project_id          TEXT    NOT NULL,
    id                  TEXT    NOT NULL,
    slug                TEXT    NOT NULL,
    created_at          INTEGER NOT NULL,
    PRIMARY KEY (project_id, id),
    CONSTRAINT chk_applications_id CHECK (id <> ''),
    CONSTRAINT chk_applications_slug CHECK (slug <> ''),
    CONSTRAINT fk_applications_project
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE UNIQUE INDEX uq_applications_project_slug
    ON applications (project_id, slug);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE application_revisions (
    project_id      TEXT    NOT NULL,
    id              TEXT    NOT NULL,
    application_id  TEXT    NOT NULL,
    document        TEXT    NOT NULL,
    created_at      INTEGER NOT NULL,
    PRIMARY KEY (project_id, id),
    CONSTRAINT chk_application_revisions_id CHECK (id <> ''),
    CONSTRAINT chk_application_revisions_document CHECK (json_type(document) = 'object'),
    CONSTRAINT fk_application_revisions_application
        FOREIGN KEY (project_id, application_id)
        REFERENCES applications (project_id, id) ON DELETE CASCADE
);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE UNIQUE INDEX uq_application_revisions_application_created_at
    ON application_revisions (project_id, application_id, created_at);
-- +goose StatementEnd

-- +goose StatementBegin
-- See the postgres migration for why no row is deleted.
CREATE TABLE application_clients (
    project_id      TEXT    NOT NULL,
    id              TEXT    NOT NULL,
    application_id  TEXT    NOT NULL,
    slug            TEXT    NOT NULL,
    client_id       TEXT    NOT NULL,
    created_at      INTEGER NOT NULL,
    PRIMARY KEY (project_id, id),
    CONSTRAINT chk_application_clients_id CHECK (id <> ''),
    CONSTRAINT chk_application_clients_slug CHECK (slug <> ''),
    CONSTRAINT chk_application_clients_client_id CHECK (client_id <> ''),
    CONSTRAINT fk_application_clients_application
        FOREIGN KEY (project_id, application_id)
        REFERENCES applications (project_id, id) ON DELETE CASCADE
);
-- +goose StatementEnd

-- +goose StatementBegin
-- See the postgres migration for why a write here can trip one of three
-- constraints.
CREATE UNIQUE INDEX uq_application_clients_project_client_id
    ON application_clients (project_id, client_id);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE UNIQUE INDEX uq_application_clients_application_slug
    ON application_clients (project_id, application_id, slug);
-- +goose StatementEnd

-- +goose StatementBegin
-- See the postgres migration for why secrets have their own table.
CREATE TABLE application_client_secrets (
    project_id             TEXT    NOT NULL,
    id                     TEXT    NOT NULL,
    application_client_id  TEXT    NOT NULL,
    secret_hash            TEXT    NOT NULL,
    created_at             INTEGER NOT NULL,
    PRIMARY KEY (project_id, id),
    CONSTRAINT chk_application_client_secrets_id CHECK (id <> ''),
    CONSTRAINT fk_application_client_secrets_client
        FOREIGN KEY (project_id, application_client_id)
        REFERENCES application_clients (project_id, id) ON DELETE CASCADE
);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_application_client_secrets_client
    ON application_client_secrets (project_id, application_client_id, created_at);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_application_client_secrets_client;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS application_client_secrets;
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS uq_application_clients_application_slug;
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS uq_application_clients_project_client_id;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS application_clients;
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS uq_application_revisions_application_created_at;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS application_revisions;
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS uq_applications_project_slug;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS applications;
-- +goose StatementEnd
