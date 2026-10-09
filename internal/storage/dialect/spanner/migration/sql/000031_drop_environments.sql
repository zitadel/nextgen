-- +goose NO TRANSACTION
-- +goose Up
-- See the postgres migration. Spanner cannot change a primary key in place, so
-- variables is rebuilt through a staging table and copied back.
-- +goose StatementBegin
CREATE TABLE variables_project (
    name             STRING(MAX) NOT NULL,
    project_id       STRING(MAX) NOT NULL,
    value            JSON        NOT NULL,
    is_secret        BOOL        NOT NULL,
    created_at       TIMESTAMP   NOT NULL,
    modified_at      TIMESTAMP   NOT NULL,
) PRIMARY KEY (name, project_id)
-- +goose StatementEnd
-- +goose StatementBegin
INSERT INTO variables_project (name, project_id, value, is_secret, created_at, modified_at)
SELECT name, project_id, value, is_secret, created_at, modified_at FROM variables WHERE environment_id = ''
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE variables
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE variables (
    name             STRING(MAX) NOT NULL,
    project_id       STRING(MAX) NOT NULL,
    value            JSON        NOT NULL,
    is_secret        BOOL        NOT NULL DEFAULT (FALSE),
    created_at       TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    modified_at      TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    CONSTRAINT variables_name_not_empty CHECK (name != ''),
    CONSTRAINT variables_project_not_empty CHECK (project_id != ''),
    CONSTRAINT fk_variables_project
        FOREIGN KEY (project_id)
        REFERENCES projects (id)
        ON DELETE CASCADE
) PRIMARY KEY (name, project_id)
-- +goose StatementEnd
-- +goose StatementBegin
INSERT INTO variables (name, project_id, value, is_secret, created_at, modified_at)
SELECT name, project_id, value, is_secret, created_at, modified_at FROM variables_project
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE variables_project
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE deployments DROP CONSTRAINT fk_deployments_environment
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX uq_environments_project_name
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE environments
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
CREATE TABLE environments (
    project_id             STRING(MAX) NOT NULL,
    id                     STRING(MAX) NOT NULL,
    name                   STRING(63)  NOT NULL,
    created_at             TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    current_deployment_id  STRING(MAX),
    CONSTRAINT chk_environments_name CHECK (name <> ''),
    CONSTRAINT fk_environments_project
        FOREIGN KEY (project_id)
        REFERENCES projects (id)
        ON DELETE CASCADE,
) PRIMARY KEY (project_id, id)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX uq_environments_project_name ON environments (project_id, name)
-- +goose StatementEnd
-- +goose StatementBegin
DELETE FROM deployments WHERE TRUE
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE deployments ADD CONSTRAINT fk_deployments_environment
    FOREIGN KEY (project_id, environment_id)
    REFERENCES environments (project_id, id)
    ON DELETE CASCADE
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE variables
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE variables (
    name             STRING(MAX) NOT NULL,
    project_id       STRING(MAX) NOT NULL,
    environment_id   STRING(MAX) NOT NULL DEFAULT (''),
    environment_ref  STRING(MAX) AS (NULLIF(environment_id, '')) STORED,
    value            JSON        NOT NULL,
    is_secret        BOOL        NOT NULL DEFAULT (FALSE),
    created_at       TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    modified_at      TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    CONSTRAINT variables_name_not_empty CHECK (name != ''),
    CONSTRAINT variables_project_not_empty CHECK (project_id != ''),
    CONSTRAINT fk_variables_project
        FOREIGN KEY (project_id)
        REFERENCES projects (id)
        ON DELETE CASCADE,
    CONSTRAINT fk_variables_environment
        FOREIGN KEY (project_id, environment_ref)
        REFERENCES environments (project_id, id)
        ON DELETE CASCADE
) PRIMARY KEY (name, project_id, environment_id)
-- +goose StatementEnd
