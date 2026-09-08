-- +goose Up
-- +goose StatementBegin
-- One row per variable. The owner is the project, which is required and
-- references projects. See the postgres migration.
CREATE TABLE variables (
    name             TEXT    NOT NULL CHECK (name <> ''),
    project_id       TEXT    NOT NULL CHECK (project_id <> ''),
    value            TEXT    NOT NULL,
    is_secret        INTEGER NOT NULL DEFAULT 0,
    created_at       INTEGER NOT NULL,
    modified_at      INTEGER NOT NULL,
    PRIMARY KEY (name, project_id),
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
