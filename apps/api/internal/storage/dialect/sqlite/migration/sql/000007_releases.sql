-- +goose Up
-- +goose StatementBegin
-- A release is an immutable, project-scoped snapshot pinning one revision per
-- (kind, handle) (ADR 035). See the postgres migration for why the pinned set
-- is a JSON document column rather than a child table. created_at is unix
-- nanos stamped in Go, as everywhere else in this dialect.
CREATE TABLE releases (
    project_id      TEXT    NOT NULL,
    id              TEXT    NOT NULL,
    content_hash    TEXT    NOT NULL,
    pointers        TEXT    NOT NULL,
    -- See the postgres migration for why the metadata is a document rather
    -- than columns, and why created_at is the exception.
    metadata        TEXT    NOT NULL,
    created_at      INTEGER NOT NULL,
    PRIMARY KEY (project_id, id),
    CONSTRAINT chk_releases_id CHECK (id <> ''),
    CONSTRAINT chk_releases_content_hash CHECK (length(content_hash) = 64),
    CONSTRAINT chk_releases_pointers CHECK (json_array_length(pointers) > 0),
    CONSTRAINT chk_releases_metadata CHECK (json_type(metadata) = 'object'),
    CONSTRAINT fk_releases_project
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);
-- +goose StatementEnd

-- +goose StatementBegin
-- The idempotency key; see the postgres migration.
CREATE UNIQUE INDEX uq_releases_project_content_hash
    ON releases (project_id, content_hash);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_releases_project_created_at
    ON releases (project_id, created_at DESC, id DESC);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_releases_project_created_at;
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS uq_releases_project_content_hash;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS releases;
-- +goose StatementEnd
