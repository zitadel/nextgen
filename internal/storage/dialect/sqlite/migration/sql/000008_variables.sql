-- +goose Up
-- +goose StatementBegin
-- One row per variable. environment_name is NOT NULL with an empty-string
-- default; the project is required and references projects. See the postgres
-- migration for why empty rather than NULL.
CREATE TABLE variables (
    name             TEXT    NOT NULL CHECK (name <> ''),
    project_id       TEXT    NOT NULL CHECK (project_id <> ''),
    -- Scoped by environment name, not id. The reference is carried by the
    -- generated column below rather than by this one, because '' is the
    -- project level and no environment row answers to it. See the postgres
    -- migration.
    environment_name TEXT    NOT NULL DEFAULT '',
    -- NULLIF maps the project level to NULL, and a composite foreign key is
    -- not checked when any of its columns is NULL, so a project-level row
    -- skips the constraint and an environment-scoped row is held to it.
    -- Derived, never written, and not bound in variable.Schema.
    environment_ref  TEXT    GENERATED ALWAYS AS (NULLIF(environment_name, '')) STORED,
    value            TEXT    NOT NULL,
    is_secret        INTEGER NOT NULL DEFAULT 0,
    created_at       INTEGER NOT NULL,
    modified_at      INTEGER NOT NULL,
    PRIMARY KEY (name, project_id, environment_name),
    FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
    -- No ON UPDATE clause, to stay in parity with Spanner. See the postgres
    -- migration.
    FOREIGN KEY (project_id, environment_ref)
        REFERENCES environments (project_id, name) ON DELETE CASCADE
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
