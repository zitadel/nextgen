-- +goose NO TRANSACTION
-- +goose Up
-- One row per variable. environment_name is NOT NULL with an empty-string
-- default; the project is required and references projects. See the postgres
-- migration for why empty rather than NULL.
-- +goose StatementBegin
CREATE TABLE variables (
    name             STRING(MAX) NOT NULL,
    project_id       STRING(MAX) NOT NULL,
    -- Scoped by environment name, not id. The reference is carried by the
    -- generated column below rather than by this one, because '' is the
    -- project level and no environment row answers to it. See the postgres
    -- migration.
    environment_name STRING(MAX) NOT NULL DEFAULT (''),
    -- NULLIF maps the project level to NULL, and a composite foreign key is
    -- not checked when any of its columns is NULL, so a project-level row
    -- skips the constraint and an environment-scoped row is held to it.
    -- Derived, never written, and not bound in variable.Schema.
    environment_ref  STRING(MAX) AS (NULLIF(environment_name, '')) STORED,
    value            JSON        NOT NULL,
    is_secret        BOOL        NOT NULL DEFAULT (FALSE),
    created_at       TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    modified_at      TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    CONSTRAINT variables_name_not_empty CHECK (name != ''),
    -- The project is required: it carries the foreign key, and a variable with
    -- no project would belong to nothing. See the postgres migration.
    CONSTRAINT variables_project_not_empty CHECK (project_id != ''),
    CONSTRAINT fk_variables_project
        FOREIGN KEY (project_id)
        REFERENCES projects (id)
        ON DELETE CASCADE,
    -- Spanner has no ON UPDATE CASCADE, which is why no dialect cascades a
    -- rename. See the postgres migration.
    CONSTRAINT fk_variables_environment
        FOREIGN KEY (project_id, environment_ref)
        REFERENCES environments (project_id, name)
        ON DELETE CASCADE
) PRIMARY KEY (name, project_id, environment_name)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
DROP TABLE IF EXISTS variables
-- +goose StatementEnd
