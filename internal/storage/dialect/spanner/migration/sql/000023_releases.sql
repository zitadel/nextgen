-- +goose NO TRANSACTION
-- +goose Up
-- +goose StatementBegin
-- A release is an immutable, project-scoped snapshot pinning one revision per
-- (kind, handle) (ADR 035). See the postgres migration for why the pinned set
-- is a JSON column rather than a child table, and why the content hash is
-- computed in Go rather than derived from that column.
CREATE TABLE releases (
    project_id      STRING(MAX) NOT NULL,
    id              STRING(MAX) NOT NULL,
    content_hash    STRING(64)  NOT NULL,
    pointers        JSON        NOT NULL,
    -- See the postgres migration for why the metadata is a document rather
    -- than columns, and why created_at is the exception.
    metadata        JSON        NOT NULL,
    created_at      TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    CONSTRAINT chk_releases_id CHECK (id <> ''),
    CONSTRAINT chk_releases_content_hash CHECK (CHAR_LENGTH(content_hash) = 64),
    CONSTRAINT fk_releases_project
        FOREIGN KEY (project_id)
        REFERENCES projects (id)
        ON DELETE CASCADE,
) PRIMARY KEY (project_id, id)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX uq_releases_project_content_hash
    ON releases (project_id, content_hash)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_releases_project_created_at
    ON releases (project_id, created_at DESC, id DESC)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_releases_project_created_at
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS uq_releases_project_content_hash
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS releases
-- +goose StatementEnd
