-- +goose NO TRANSACTION
-- +goose Up
-- Move origins off the projects JSON column into a natural-key child table.
-- Expand the JSON array (object or legacy string elements) into rows before
-- dropping the column so stacked PR1→PR2 upgrades keep persisted origins.
-- +goose StatementBegin
CREATE TABLE project_origins (
    project_id STRING(MAX) NOT NULL,
    pattern STRING(MAX) NOT NULL,
    kind STRING(MAX) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    CONSTRAINT project_origins_pattern_not_empty CHECK (pattern != ''),
    CONSTRAINT project_origins_kind_valid CHECK (kind IN ('primary', 'preview')),
    CONSTRAINT fk_project_origins_project
        FOREIGN KEY (project_id)
        REFERENCES projects (id)
        ON DELETE CASCADE
) PRIMARY KEY (project_id, pattern)
-- +goose StatementEnd
-- +goose StatementBegin
INSERT INTO project_origins (project_id, pattern, kind, created_at)
SELECT
    p.id,
    CASE
        WHEN JSON_TYPE(elem) = 'object' THEN JSON_VALUE(elem, '$.pattern')
        ELSE JSON_VALUE(elem, '$')
    END,
    CASE
        WHEN JSON_TYPE(elem) = 'object' THEN COALESCE(JSON_VALUE(elem, '$.kind'), 'preview')
        ELSE 'preview'
    END,
    p.created_at
FROM projects AS p,
UNNEST(JSON_QUERY_ARRAY(PARSE_JSON(p.origins))) AS elem WITH OFFSET AS off
WHERE CASE
    WHEN JSON_TYPE(elem) = 'object' THEN JSON_VALUE(elem, '$.pattern')
    ELSE JSON_VALUE(elem, '$')
END IS NOT NULL
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE projects DROP COLUMN origins
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
ALTER TABLE projects ADD COLUMN origins STRING(MAX)
-- +goose StatementEnd
-- +goose StatementBegin
UPDATE projects AS p
SET origins = COALESCE(
    (
        SELECT TO_JSON_STRING(ARRAY_AGG(
            JSON_OBJECT('pattern', o.pattern, 'kind', o.kind)
            ORDER BY o.created_at, o.pattern
        ))
        FROM project_origins AS o
        WHERE o.project_id = p.id
    ),
    '[]'
) WHERE TRUE
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE projects ALTER COLUMN origins STRING(MAX) NOT NULL
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE project_origins
-- +goose StatementEnd
