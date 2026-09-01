-- +goose NO TRANSACTION
-- +goose Up
-- One row per setting leaf. Owner ids are NOT NULL with an empty-string default;
-- see the postgres migration for why empty rather than NULL.
-- +goose StatementBegin
CREATE TABLE settings (
    path           STRING(MAX) NOT NULL,
    project_id     STRING(MAX) NOT NULL DEFAULT (''),
    team_id        STRING(MAX) NOT NULL DEFAULT (''),
    application_id STRING(MAX) NOT NULL DEFAULT (''),
    user_id        STRING(MAX) NOT NULL DEFAULT (''),
    value          JSON        NOT NULL,
    is_final       BOOL        NOT NULL DEFAULT (FALSE),
    created_at     TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    modified_at    TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    CONSTRAINT settings_path_not_empty CHECK (path != ''),
    -- A leaf cannot be owned at a level whose ancestors are unset: an owner such
    -- as (team_id set, project_id '') would otherwise be readable from any
    -- project, because an empty owner id reads as a wildcard.
    CONSTRAINT settings_owner_chain CHECK (
        (project_id != '' OR (team_id = '' AND application_id = '' AND user_id = ''))
        AND (team_id != '' OR (application_id = '' AND user_id = ''))
        AND (application_id != '' OR user_id = '')
    )
) PRIMARY KEY (path, project_id, team_id, application_id, user_id)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
DROP TABLE IF EXISTS settings
-- +goose StatementEnd
