-- +goose Up
-- +goose StatementBegin
-- An app is revisioned like an identity provider connection; see the postgres
-- migration for the tables and why each exists. created_at is unix nanos
-- stamped in Go, as everywhere else in this dialect.
CREATE TABLE apps (
    project_id          TEXT    NOT NULL,
    id                  TEXT    NOT NULL,
    slug                TEXT    NOT NULL,
    source              TEXT    NOT NULL,
    created_at          INTEGER NOT NULL,
    PRIMARY KEY (project_id, id),
    CONSTRAINT chk_apps_id CHECK (id <> ''),
    CONSTRAINT chk_apps_slug CHECK (slug <> ''),
    CONSTRAINT chk_apps_source CHECK (source IN ('declared', 'registered')),
    CONSTRAINT fk_apps_project
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE UNIQUE INDEX uq_apps_project_slug
    ON apps (project_id, slug);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_apps_project_created_at
    ON apps (project_id, created_at, id);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE app_revisions (
    project_id      TEXT    NOT NULL,
    id              TEXT    NOT NULL,
    app_id          TEXT    NOT NULL,
    document        TEXT    NOT NULL,
    created_at      INTEGER NOT NULL,
    PRIMARY KEY (project_id, id),
    CONSTRAINT chk_app_revisions_id CHECK (id <> ''),
    CONSTRAINT chk_app_revisions_document CHECK (json_type(document) = 'object'),
    CONSTRAINT fk_app_revisions_app
        FOREIGN KEY (project_id, app_id)
        REFERENCES apps (project_id, id) ON DELETE CASCADE
);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE UNIQUE INDEX uq_app_revisions_app_created_at
    ON app_revisions (project_id, app_id, created_at);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE app_clients (
    project_id      TEXT    NOT NULL,
    id              TEXT    NOT NULL,
    app_id          TEXT    NOT NULL,
    slug            TEXT    NOT NULL,
    client_id       TEXT    NOT NULL,
    created_at      INTEGER NOT NULL,
    PRIMARY KEY (project_id, id),
    CONSTRAINT chk_app_clients_id CHECK (id <> ''),
    CONSTRAINT chk_app_clients_slug CHECK (slug <> ''),
    CONSTRAINT chk_app_clients_client_id CHECK (client_id <> ''),
    CONSTRAINT fk_app_clients_app
        FOREIGN KEY (project_id, app_id)
        REFERENCES apps (project_id, id) ON DELETE CASCADE
);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE UNIQUE INDEX uq_app_clients_project_client_id
    ON app_clients (project_id, client_id);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE UNIQUE INDEX uq_app_clients_app_slug
    ON app_clients (project_id, app_id, slug);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE app_api_identifiers (
    project_id      TEXT    NOT NULL,
    identifier      TEXT    NOT NULL,
    app_id          TEXT    NOT NULL,
    created_at      INTEGER NOT NULL,
    PRIMARY KEY (project_id, identifier),
    CONSTRAINT chk_app_api_identifiers_identifier CHECK (identifier <> ''),
    CONSTRAINT fk_app_api_identifiers_app
        FOREIGN KEY (project_id, app_id)
        REFERENCES apps (project_id, id) ON DELETE CASCADE
);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_app_api_identifiers_app
    ON app_api_identifiers (project_id, app_id);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE app_client_credentials (
    project_id      TEXT    NOT NULL,
    id              TEXT    NOT NULL,
    client_row_id   TEXT    NOT NULL,
    name            TEXT    NOT NULL,
    kind            TEXT    NOT NULL,
    encoded_hash    TEXT,
    public_key      TEXT,
    key_id          TEXT,
    created_at      INTEGER NOT NULL,
    expires_at      INTEGER,
    PRIMARY KEY (project_id, id),
    CONSTRAINT chk_app_client_credentials_id CHECK (id <> ''),
    CONSTRAINT chk_app_client_credentials_name CHECK (name <> ''),
    CONSTRAINT chk_app_client_credentials_kind CHECK (
        (kind = 'secret' AND encoded_hash IS NOT NULL AND encoded_hash <> ''
            AND public_key IS NULL AND key_id IS NULL)
        OR (kind = 'key' AND encoded_hash IS NULL AND public_key IS NOT NULL
            AND json_type(public_key) = 'object' AND key_id IS NOT NULL AND key_id <> '')
    ),
    CONSTRAINT fk_app_client_credentials_client
        FOREIGN KEY (project_id, client_row_id)
        REFERENCES app_clients (project_id, id) ON DELETE CASCADE
);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE UNIQUE INDEX uq_app_client_credentials_client_name
    ON app_client_credentials (project_id, client_row_id, name);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS uq_app_client_credentials_client_name;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS app_client_credentials;
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_app_api_identifiers_app;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS app_api_identifiers;
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS uq_app_clients_app_slug;
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS uq_app_clients_project_client_id;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS app_clients;
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS uq_app_revisions_app_created_at;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS app_revisions;
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_apps_project_created_at;
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS uq_apps_project_slug;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS apps;
-- +goose StatementEnd
