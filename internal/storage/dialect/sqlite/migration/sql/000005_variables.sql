-- +goose Up
-- +goose StatementBegin
-- One row per variable. Owner ids are NOT NULL with an empty-string default;
-- see the postgres migration for why empty rather than NULL.
CREATE TABLE variables (
    name           TEXT    NOT NULL CHECK (name <> ''),
    project_id     TEXT    NOT NULL DEFAULT '',
    team_id        TEXT    NOT NULL DEFAULT '',
    user_schema_id TEXT    NOT NULL DEFAULT '',
    user_id        TEXT    NOT NULL DEFAULT '',
    value          TEXT    NOT NULL DEFAULT '{}',
    is_secret      INTEGER NOT NULL DEFAULT 0,
    created_at     INTEGER NOT NULL,
    modified_at    INTEGER NOT NULL,
    PRIMARY KEY (name, project_id, team_id, user_schema_id, user_id),
    -- A variable cannot be owned at a level whose ancestors are unset: an owner
    -- such as (team_id set, project_id '') would otherwise be readable from any
    -- project, because an empty owner id reads as a wildcard.
    CONSTRAINT variables_owner_chain CHECK (
        (project_id <> '' OR (team_id = '' AND user_schema_id = '' AND user_id = ''))
        AND (team_id <> '' OR (user_schema_id = '' AND user_id = ''))
        AND (user_schema_id <> '' OR user_id = '')
    )
);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS variables;
-- +goose StatementEnd
