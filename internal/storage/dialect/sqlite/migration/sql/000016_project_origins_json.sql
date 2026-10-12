-- +goose Up
-- Replace preview_origins JSON string[] with origins JSON of {pattern, kind}[].
-- SQLite cannot DROP COLUMN with a CHECK-heavy rewrite easily; recreate the table.
-- +goose StatementBegin
CREATE TABLE projects_new (
    id TEXT PRIMARY KEY NOT NULL
    , name TEXT NOT NULL
    , origins TEXT NOT NULL DEFAULT '[]'
    , password_hash_policy TEXT
    , created_at INTEGER NOT NULL
    , updated_at INTEGER NOT NULL
);
-- +goose StatementEnd
-- +goose StatementBegin
INSERT INTO projects_new (id, name, origins, password_hash_policy, created_at, updated_at)
SELECT
    id,
    name,
    CASE
        WHEN preview_origins IS NULL OR preview_origins = '' THEN '[]'
        ELSE preview_origins
    END,
    password_hash_policy,
    created_at,
    updated_at
FROM projects;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE projects;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE projects_new RENAME TO projects;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
CREATE TABLE projects_old (
    id TEXT PRIMARY KEY NOT NULL
    , name TEXT NOT NULL
    , preview_origins TEXT NOT NULL DEFAULT '[]'
    , password_hash_policy TEXT
    , created_at INTEGER NOT NULL
    , updated_at INTEGER NOT NULL
);
-- +goose StatementEnd
-- +goose StatementBegin
INSERT INTO projects_old (id, name, preview_origins, password_hash_policy, created_at, updated_at)
SELECT id, name, origins, password_hash_policy, created_at, updated_at FROM projects;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE projects;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE projects_old RENAME TO projects;
-- +goose StatementEnd
