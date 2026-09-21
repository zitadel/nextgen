-- +goose Up
-- +goose StatementBegin
-- An identity provider connection is strictly revisioned; see the postgres
-- migration for why the head is a pointer column rather than an ordering, and
-- why it carries no foreign key, and why there is no updated_at. created_at is
-- unix nanos stamped in Go, as everywhere else in this dialect.
CREATE TABLE idp_connections (
    project_id          TEXT    NOT NULL,
    id                  TEXT    NOT NULL,
    slug                TEXT    NOT NULL,
    latest_revision_id  TEXT    NOT NULL,
    created_at          INTEGER NOT NULL,
    PRIMARY KEY (project_id, id),
    CONSTRAINT chk_idp_connections_id CHECK (id <> ''),
    CONSTRAINT chk_idp_connections_slug CHECK (slug <> ''),
    CONSTRAINT chk_idp_connections_latest_revision_id CHECK (latest_revision_id <> ''),
    CONSTRAINT fk_idp_connections_project
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);
-- +goose StatementEnd

-- +goose StatementBegin
-- The only user-reachable unique constraint besides the PK; see the postgres
-- migration.
CREATE UNIQUE INDEX uq_idp_connections_project_slug
    ON idp_connections (project_id, slug);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_idp_connections_project_created_at
    ON idp_connections (project_id, created_at, id);
-- +goose StatementEnd

-- +goose StatementBegin
-- One revision of one connection; rows are never updated. See the postgres
-- migration for why the document is opaque and why there is no project FK here.
CREATE TABLE idp_connection_revisions (
    project_id      TEXT    NOT NULL,
    id              TEXT    NOT NULL,
    connection_id   TEXT    NOT NULL,
    document        TEXT    NOT NULL,
    created_at      INTEGER NOT NULL,
    PRIMARY KEY (project_id, id),
    CONSTRAINT chk_idp_connection_revisions_id CHECK (id <> ''),
    CONSTRAINT chk_idp_connection_revisions_document CHECK (json_type(document) = 'object'),
    CONSTRAINT fk_idp_connection_revisions_connection
        FOREIGN KEY (project_id, connection_id)
        REFERENCES idp_connections (project_id, id) ON DELETE CASCADE
);
-- +goose StatementEnd

-- +goose StatementBegin
-- The parent walk plus the revision keyset; see the postgres migration.
CREATE INDEX idx_idp_connection_revisions_connection
    ON idp_connection_revisions (project_id, connection_id, created_at, id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_idp_connection_revisions_connection;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS idp_connection_revisions;
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_idp_connections_project_created_at;
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS uq_idp_connections_project_slug;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS idp_connections;
-- +goose StatementEnd
