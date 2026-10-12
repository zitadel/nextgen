-- +goose NO TRANSACTION
-- +goose Up
-- Move origins off the projects JSON column into a natural-key child table.
-- Spanner cannot expand a JSON array into rows in SQL the way Postgres can;
-- stacked PR1→PR2 means no persisted origins JSON needs carrying forward.
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
ALTER TABLE projects DROP COLUMN origins
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
ALTER TABLE projects ADD COLUMN origins STRING(MAX)
-- +goose StatementEnd
-- +goose StatementBegin
UPDATE projects SET origins = '[]' WHERE TRUE
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE projects ALTER COLUMN origins STRING(MAX) NOT NULL
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE project_origins
-- +goose StatementEnd
