-- +goose NO TRANSACTION
-- +goose Up
-- One row per variable. Owner ids are NOT NULL with an empty-string default;
-- see the postgres migration for why empty rather than NULL.
-- +goose StatementBegin
CREATE TABLE variables (
    name             STRING(MAX) NOT NULL,
    project_id       STRING(MAX) NOT NULL DEFAULT (''),
    environment_name STRING(MAX) NOT NULL DEFAULT (''),
    team_id          STRING(MAX) NOT NULL DEFAULT (''),
    user_schema_id   STRING(MAX) NOT NULL DEFAULT (''),
    user_id          STRING(MAX) NOT NULL DEFAULT (''),
    value            JSON        NOT NULL,
    is_secret        BOOL        NOT NULL DEFAULT (FALSE),
    created_at       TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    modified_at      TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    CONSTRAINT variables_name_not_empty CHECK (name != ''),
    -- Owner levels below the project are independent; only the project is
    -- required, because an empty owner id reads as a wildcard on read and an
    -- owner such as (team_id set, project_id '') would otherwise be readable
    -- from any project. See the postgres migration.
    CONSTRAINT variables_owner_needs_project CHECK (
        project_id != ''
        OR (environment_name = '' AND team_id = '' AND user_schema_id = '' AND user_id = '')
    )
) PRIMARY KEY (name, project_id, environment_name, team_id, user_schema_id, user_id)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
DROP TABLE IF EXISTS variables
-- +goose StatementEnd
