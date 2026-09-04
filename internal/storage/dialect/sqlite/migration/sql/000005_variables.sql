-- +goose Up
-- +goose StatementBegin
-- One row per variable. The owner ids below the project are NOT NULL with an
-- empty-string default; the project is required and references projects. See the
-- postgres migration for why empty rather than NULL.
CREATE TABLE variables (
    name             TEXT    NOT NULL CHECK (name <> ''),
    project_id       TEXT    NOT NULL CHECK (project_id <> ''),
    -- TODO: environments are not a resource yet (ADR 035 defers their
    -- internals), so this is free text with nothing to reference. Give it the
    -- same treatment as project_id once they exist.
    environment_name TEXT    NOT NULL DEFAULT '',
    team_id          TEXT    NOT NULL DEFAULT '',
    user_schema_id   TEXT    NOT NULL DEFAULT '',
    user_id          TEXT    NOT NULL DEFAULT '',
    value            TEXT    NOT NULL DEFAULT '{}',
    is_secret        INTEGER NOT NULL DEFAULT 0,
    created_at       INTEGER NOT NULL,
    modified_at      INTEGER NOT NULL,
    PRIMARY KEY (name, project_id, environment_name, team_id, user_schema_id, user_id),
    FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);
-- +goose StatementEnd

-- The primary key leads with name, so nothing above serves a read of one
-- project. See the postgres migration.
-- +goose StatementBegin
CREATE INDEX idx_variables_project_name ON variables (project_id, name);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_variables_project_name;
-- +goose StatementEnd

-- +goose StatementBegin
DROP TABLE IF EXISTS variables;
-- +goose StatementEnd
