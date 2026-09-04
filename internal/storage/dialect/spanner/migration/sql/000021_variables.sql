-- +goose NO TRANSACTION
-- +goose Up
-- One row per variable. The owner ids below the project are NOT NULL with an
-- empty-string default; the project is required and references projects. See the
-- postgres migration for why empty rather than NULL.
-- +goose StatementBegin
CREATE TABLE variables (
    name             STRING(MAX) NOT NULL,
    project_id       STRING(MAX) NOT NULL,
    -- TODO: environments are not a resource yet (ADR 035 defers their
    -- internals), so this is free text with nothing to reference. Give it the
    -- same treatment as project_id once they exist.
    environment_name STRING(MAX) NOT NULL DEFAULT (''),
    team_id          STRING(MAX) NOT NULL DEFAULT (''),
    user_schema_id   STRING(MAX) NOT NULL DEFAULT (''),
    user_id          STRING(MAX) NOT NULL DEFAULT (''),
    value            JSON        NOT NULL,
    is_secret        BOOL        NOT NULL DEFAULT (FALSE),
    created_at       TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    modified_at      TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    CONSTRAINT variables_name_not_empty CHECK (name != ''),
    -- Owner levels below the project are independent of one another, so any
    -- combination of them is storable. The project is required, because an
    -- empty owner id reads as a wildcard on read. See the postgres migration.
    CONSTRAINT variables_project_not_empty CHECK (project_id != ''),
    CONSTRAINT fk_variables_project
        FOREIGN KEY (project_id)
        REFERENCES projects (id)
        ON DELETE CASCADE
) PRIMARY KEY (name, project_id, environment_name, team_id, user_schema_id, user_id)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
DROP TABLE IF EXISTS variables
-- +goose StatementEnd
