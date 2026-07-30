-- +goose NO TRANSACTION
-- +goose Up
-- +goose StatementBegin
CREATE TABLE teams (
    project_id  STRING(MAX) NOT NULL,
    id          STRING(MAX) NOT NULL,
    name        STRING(200) NOT NULL,
    created_at  TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    updated_at  TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    -- Spanner cannot index an expression, so the lowered name is materialised
    -- to back the case-insensitive unique index below.
    name_lower  STRING(MAX) AS (LOWER(name)) STORED,
    CONSTRAINT chk_teams_name CHECK (name <> ''),
    CONSTRAINT fk_teams_project
        FOREIGN KEY (project_id)
        REFERENCES projects (id)
        ON DELETE CASCADE,
) PRIMARY KEY (project_id, id)
-- +goose StatementEnd
-- +goose StatementBegin
-- Team names are unique per project, case-insensitive.
CREATE UNIQUE INDEX uq_teams_project_name
    ON teams (project_id, name_lower)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
DROP INDEX IF EXISTS uq_teams_project_name
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS teams
-- +goose StatementEnd
