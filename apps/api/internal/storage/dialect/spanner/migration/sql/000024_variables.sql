-- +goose NO TRANSACTION
-- +goose Up
-- One row per variable. environment_id is NOT NULL with an empty-string
-- default; the project is required and references projects. See the postgres
-- migration for why empty rather than NULL.
-- +goose StatementBegin
CREATE TABLE variables (
    name             STRING(MAX) NOT NULL,
    project_id       STRING(MAX) NOT NULL,
    -- Scoped by environment id, not name: the wire addresses an environment by
    -- name and the name is resolved to this id at the edge, so a rename does
    -- not touch this table. The reference is carried by the generated column
    -- below rather than by this one, because '' is the project level and no
    -- environment row answers to it. See the postgres migration.
    environment_id   STRING(MAX) NOT NULL DEFAULT (''),
    -- NULLIF maps the project level to NULL, and a composite foreign key is
    -- not checked when any of its columns is NULL, so a project-level row
    -- skips the constraint and an environment-scoped row is held to it.
    -- Derived, never written, and not bound in variable.Schema.
    environment_ref  STRING(MAX) AS (NULLIF(environment_id, '')) STORED,
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
    -- No ON UPDATE clause is needed: the id is the environment's primary key
    -- and a rename does not touch it. See the postgres migration.
    CONSTRAINT fk_variables_environment
        FOREIGN KEY (project_id, environment_ref)
        REFERENCES environments (project_id, id)
        ON DELETE CASCADE
) PRIMARY KEY (name, project_id, environment_id)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
DROP TABLE IF EXISTS variables
-- +goose StatementEnd
