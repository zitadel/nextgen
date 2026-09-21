-- +goose NO TRANSACTION
-- +goose Up
-- +goose StatementBegin
-- An identity provider connection is strictly revisioned; see the postgres
-- migration for why the head is a pointer column rather than an ordering, and
-- why it carries no foreign key.
CREATE TABLE idp_connections (
    project_id          STRING(MAX) NOT NULL,
    id                  STRING(MAX) NOT NULL,
    slug                STRING(MAX) NOT NULL,
    latest_revision_id  STRING(MAX) NOT NULL,
    -- No updated_at; see the postgres migration.
    created_at          TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    CONSTRAINT chk_idp_connections_id CHECK (id <> ''),
    CONSTRAINT chk_idp_connections_slug CHECK (slug <> ''),
    CONSTRAINT chk_idp_connections_latest_revision_id CHECK (latest_revision_id <> ''),
    CONSTRAINT fk_idp_connections_project
        FOREIGN KEY (project_id)
        REFERENCES projects (id)
        ON DELETE CASCADE,
) PRIMARY KEY (project_id, id)
-- +goose StatementEnd
-- +goose StatementBegin
-- The only user-reachable unique constraint besides the PK; see the postgres
-- migration. Not NULL_FILTERED: slug is NOT NULL, so there is nothing to filter.
CREATE UNIQUE INDEX uq_idp_connections_project_slug
    ON idp_connections (project_id, slug)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_idp_connections_project_created_at
    ON idp_connections (project_id, created_at, id)
-- +goose StatementEnd
-- +goose StatementBegin
-- One revision of one connection; rows are never updated. See the postgres
-- migration for why the document is opaque and why there is no project FK here.
CREATE TABLE idp_connection_revisions (
    project_id      STRING(MAX) NOT NULL,
    id              STRING(MAX) NOT NULL,
    connection_id   STRING(MAX) NOT NULL,
    document        JSON        NOT NULL,
    created_at      TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    CONSTRAINT chk_idp_connection_revisions_id CHECK (id <> ''),
    CONSTRAINT fk_idp_connection_revisions_connection
        FOREIGN KEY (project_id, connection_id)
        REFERENCES idp_connections (project_id, id)
        ON DELETE CASCADE,
) PRIMARY KEY (project_id, id)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_idp_connection_revisions_connection
    ON idp_connection_revisions (project_id, connection_id)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_idp_connection_revisions_connection
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS idp_connection_revisions
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_idp_connections_project_created_at
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS uq_idp_connections_project_slug
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS idp_connections
-- +goose StatementEnd
