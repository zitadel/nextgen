-- +goose Up
-- Move origins off the projects JSON column into a natural-key child table.
-- Use j.type (not json_type(j.value)): json_each exposes string elements as
-- unquoted text, so reparsing j.value aborts on legacy string arrays.
-- DROP COLUMN keeps the parent table (and ON DELETE CASCADE children) intact.
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
        WHEN j.type = 'object' THEN json_extract(j.value, '$.pattern')
        ELSE j.value
    END,
    CASE
        WHEN j.type = 'object' THEN COALESCE(json_extract(j.value, '$.kind'), 'preview')
        ELSE 'preview'
    END,
    p.created_at
FROM projects p, json_each(p.origins) AS j
WHERE p.origins IS NOT NULL
  AND p.origins != ''
  AND p.origins != '[]';
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE projects DROP COLUMN origins;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE projects ADD COLUMN origins TEXT NOT NULL DEFAULT '[]';
-- +goose StatementEnd
-- +goose StatementBegin
UPDATE projects
SET origins = COALESCE(
    (
        SELECT json_group_array(json_object('pattern', o.pattern, 'kind', o.kind))
        FROM project_origins o
        WHERE o.project_id = projects.id
    ),
    '[]'
);
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE project_origins;
-- +goose StatementEnd
