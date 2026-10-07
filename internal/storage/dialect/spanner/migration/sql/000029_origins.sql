-- +goose NO TRANSACTION
-- +goose Up
-- Deployments key on an origin string rather than on an environment row; see
-- the postgres migration.
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_deployments_project_deployed_at
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_deployments_project_env_deployed_at
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS deployments
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS variables
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS uq_environments_project_name
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS environments
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE projects DROP COLUMN preview_origins
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE projects ADD COLUMN origins JSON NOT NULL DEFAULT (JSON '[]')
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE projects ADD COLUMN mode STRING(MAX) NOT NULL DEFAULT ('sandbox')
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE releases ADD COLUMN revoked_at TIMESTAMP
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE previews (
    project_id  STRING(MAX) NOT NULL,
    origin      STRING(MAX) NOT NULL,
    expires_at  TIMESTAMP   NOT NULL,
    created_at  TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    CONSTRAINT chk_previews_origin CHECK (origin <> ''),
    CONSTRAINT fk_previews_project
        FOREIGN KEY (project_id)
        REFERENCES projects (id)
        ON DELETE CASCADE,
) PRIMARY KEY (project_id, origin)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_previews_expires_at ON previews (expires_at)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE deployments (
    project_id   STRING(MAX) NOT NULL,
    id           STRING(MAX) NOT NULL,
    release_id   STRING(MAX) NOT NULL,
    metadata     JSON        NOT NULL,
    deployed_at  TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    CONSTRAINT chk_deployments_id CHECK (id <> ''),
    CONSTRAINT fk_deployments_project
        FOREIGN KEY (project_id)
        REFERENCES projects (id)
        ON DELETE CASCADE,
    CONSTRAINT fk_deployments_release
        FOREIGN KEY (project_id, release_id)
        REFERENCES releases (project_id, id),
) PRIMARY KEY (project_id, id)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_deployments_project_deployed_at
    ON deployments (project_id, deployed_at DESC, id DESC)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE deployment_targets (
    project_id     STRING(MAX) NOT NULL,
    deployment_id  STRING(MAX) NOT NULL,
    origin         STRING(MAX) NOT NULL DEFAULT (''),
    release_id     STRING(MAX) NOT NULL,
    deployed_at    TIMESTAMP   NOT NULL,
    CONSTRAINT fk_deployment_targets_deployment
        FOREIGN KEY (project_id, deployment_id)
        REFERENCES deployments (project_id, id)
        ON DELETE CASCADE,
) PRIMARY KEY (project_id, deployment_id, origin)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_deployment_targets_project_origin_deployed_at
    ON deployment_targets (project_id, origin, deployed_at DESC, deployment_id DESC)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE variables (
    project_id   STRING(MAX) NOT NULL,
    name         STRING(MAX) NOT NULL,
    applies_to   STRING(MAX) NOT NULL DEFAULT ('all'),
    value        JSON        NOT NULL,
    is_secret    BOOL        NOT NULL DEFAULT (FALSE),
    created_at   TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    modified_at  TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    CONSTRAINT variables_name_not_empty CHECK (name != ''),
    CONSTRAINT variables_project_not_empty CHECK (project_id != ''),
    CONSTRAINT variables_applies_to CHECK (applies_to IN ('all', 'preview')),
    CONSTRAINT fk_variables_project
        FOREIGN KEY (project_id)
        REFERENCES projects (id)
        ON DELETE CASCADE
) PRIMARY KEY (project_id, name, applies_to)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE deployment_variables (
    project_id     STRING(MAX) NOT NULL,
    deployment_id  STRING(MAX) NOT NULL,
    name           STRING(MAX) NOT NULL,
    value          JSON        NOT NULL,
    is_secret      BOOL        NOT NULL DEFAULT (FALSE),
    CONSTRAINT deployment_variables_name_not_empty CHECK (name != ''),
    CONSTRAINT fk_deployment_variables_deployment
        FOREIGN KEY (project_id, deployment_id)
        REFERENCES deployments (project_id, id)
        ON DELETE CASCADE
) PRIMARY KEY (project_id, deployment_id, name)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
DROP TABLE IF EXISTS deployment_variables
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS variables
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_deployment_targets_project_origin_deployed_at
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS deployment_targets
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_deployments_project_deployed_at
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS deployments
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_previews_expires_at
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS previews
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE releases DROP COLUMN revoked_at
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE projects DROP COLUMN mode
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE projects DROP COLUMN origins
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE projects ADD COLUMN preview_origins STRING(MAX) NOT NULL DEFAULT ('[]')
-- +goose StatementEnd
