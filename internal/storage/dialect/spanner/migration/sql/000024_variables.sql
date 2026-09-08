-- +goose NO TRANSACTION
-- +goose Up
-- One row per variable. The owner is the project, which is required and
-- references projects. See the postgres migration.
-- +goose StatementBegin
CREATE TABLE variables (
    name             STRING(MAX) NOT NULL,
    project_id       STRING(MAX) NOT NULL,
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
        ON DELETE CASCADE
) PRIMARY KEY (name, project_id)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
DROP TABLE IF EXISTS variables
-- +goose StatementEnd
