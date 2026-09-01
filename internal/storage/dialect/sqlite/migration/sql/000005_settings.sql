-- +goose Up
-- +goose StatementBegin
-- One row per setting leaf. Owner ids are NOT NULL with an empty-string default;
-- see the postgres migration for why empty rather than NULL.
CREATE TABLE settings (
    path           TEXT    NOT NULL CHECK (path <> ''),
    project_id     TEXT    NOT NULL DEFAULT '',
    team_id        TEXT    NOT NULL DEFAULT '',
    application_id TEXT    NOT NULL DEFAULT '',
    user_id        TEXT    NOT NULL DEFAULT '',
    value          TEXT    NOT NULL DEFAULT '{}',
    is_final       INTEGER NOT NULL DEFAULT 0,
    created_at     INTEGER NOT NULL,
    modified_at    INTEGER NOT NULL,
    PRIMARY KEY (path, project_id, team_id, application_id, user_id),
    -- A leaf cannot be owned at a level whose ancestors are unset: an owner such
    -- as (team_id set, project_id '') would otherwise be readable from any
    -- project, because an empty owner id reads as a wildcard.
    CONSTRAINT settings_owner_chain CHECK (
        (project_id <> '' OR (team_id = '' AND application_id = '' AND user_id = ''))
        AND (team_id <> '' OR (application_id = '' AND user_id = ''))
        AND (application_id <> '' OR user_id = '')
    )
);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS settings;
-- +goose StatementEnd
