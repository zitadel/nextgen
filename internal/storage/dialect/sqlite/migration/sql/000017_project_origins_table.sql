-- +goose Up
-- Move origins off the projects JSON column into a natural-key child table.
-- +goose StatementBegin
CREATE TABLE project_origins (
    project_id TEXT NOT NULL
    , pattern TEXT NOT NULL CHECK (pattern <> '')
    , kind TEXT NOT NULL CHECK (kind IN ('primary', 'preview'))
    , created_at INTEGER NOT NULL
    , PRIMARY KEY (project_id, pattern)
    , FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);
-- +goose StatementEnd
-- +goose StatementBegin
INSERT INTO project_origins (project_id, pattern, kind, created_at)
SELECT
    p.id,
    CASE
        WHEN json_type(j.value) = 'object' THEN json_extract(j.value, '$.pattern')
        ELSE j.value
    END,
    CASE
        WHEN json_type(j.value) = 'object' THEN COALESCE(json_extract(j.value, '$.kind'), 'preview')
        ELSE 'preview'
    END,
    p.created_at
FROM projects p, json_each(p.origins) AS j
WHERE p.origins IS NOT NULL
  AND p.origins != ''
  AND p.origins != '[]';
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE projects_new (
    id TEXT PRIMARY KEY NOT NULL
    , name TEXT NOT NULL
    , password_hash_policy TEXT
    , created_at INTEGER NOT NULL
    , updated_at INTEGER NOT NULL
);
-- +goose StatementEnd
-- +goose StatementBegin
INSERT INTO projects_new (id, name, password_hash_policy, created_at, updated_at)
SELECT id, name, password_hash_policy, created_at, updated_at FROM projects;
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
    , origins TEXT NOT NULL DEFAULT '[]'
    , password_hash_policy TEXT
    , created_at INTEGER NOT NULL
    , updated_at INTEGER NOT NULL
);
-- +goose StatementEnd
-- +goose StatementBegin
INSERT INTO projects_old (id, name, origins, password_hash_policy, created_at, updated_at)
SELECT
    p.id,
    p.name,
    COALESCE(
        (
            SELECT json_group_array(json_object('pattern', o.pattern, 'kind', o.kind))
            FROM project_origins o
            WHERE o.project_id = p.id
        ),
        '[]'
    ),
    p.password_hash_policy,
    p.created_at,
    p.updated_at
FROM projects p;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE project_origins;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE projects;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE projects_old RENAME TO projects;
-- +goose StatementEnd
