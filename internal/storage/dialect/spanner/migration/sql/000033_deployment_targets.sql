-- +goose NO TRANSACTION
-- +goose Up
-- See the postgres migration. Nothing stored is kept, so deployments is
-- recreated.
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_deployments_project_deployed_at
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_deployments_project_env_deployed_at
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE deployments
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE deployments (
    project_id   STRING(MAX) NOT NULL,
    id           STRING(MAX) NOT NULL,
    release_id   STRING(MAX) NOT NULL,
    target_kind  STRING(MAX) NOT NULL,
    metadata     JSON        NOT NULL,
    deployed_at  TIMESTAMP   NOT NULL,
    CONSTRAINT chk_deployments_id CHECK (id <> ''),
    CONSTRAINT chk_deployments_target_kind CHECK (target_kind IN ('primary', 'preview')),
    CONSTRAINT fk_deployments_project
        FOREIGN KEY (project_id)
        REFERENCES projects (id)
        ON DELETE CASCADE,
    -- See the postgres migration for why this is NO ACTION.
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
    origin         STRING(MAX) NOT NULL,
    release_id     STRING(MAX) NOT NULL,
    deployed_at    TIMESTAMP   NOT NULL,
    CONSTRAINT chk_deployment_targets_origin CHECK (origin <> ''),
    CONSTRAINT fk_deployment_targets_deployment
        FOREIGN KEY (project_id, deployment_id)
        REFERENCES deployments (project_id, id)
        ON DELETE CASCADE,
) PRIMARY KEY (project_id, deployment_id, origin)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_deployment_targets_origin_newest
    ON deployment_targets (project_id, origin, deployed_at DESC, deployment_id DESC)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE previews (
    project_id  STRING(MAX) NOT NULL,
    origin      STRING(MAX) NOT NULL,
    expires_at  TIMESTAMP   NOT NULL,
    created_at  TIMESTAMP   NOT NULL,
    CONSTRAINT chk_previews_origin CHECK (origin <> ''),
    CONSTRAINT fk_previews_project
        FOREIGN KEY (project_id)
        REFERENCES projects (id)
        ON DELETE CASCADE,
) PRIMARY KEY (project_id, origin)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_previews_project_created_at
    ON previews (project_id, created_at DESC, origin DESC)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_previews_project_expires_at
    ON previews (project_id, expires_at, origin)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_previews_project_expires_at
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_previews_project_created_at
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS previews
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_deployment_targets_origin_newest
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
CREATE TABLE deployments (
    project_id              STRING(MAX) NOT NULL,
    id                      STRING(MAX) NOT NULL,
    environment_id          STRING(MAX) NOT NULL,
    release_id              STRING(MAX) NOT NULL,
    metadata                JSON        NOT NULL,
    deployed_at             TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    CONSTRAINT chk_deployments_id CHECK (id <> ''),
    CONSTRAINT fk_deployments_release
        FOREIGN KEY (project_id, release_id)
        REFERENCES releases (project_id, id)
        ON DELETE CASCADE,
) PRIMARY KEY (project_id, id)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_deployments_project_env_deployed_at
    ON deployments (project_id, environment_id, deployed_at DESC, id DESC)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_deployments_project_deployed_at
    ON deployments (project_id, deployed_at DESC, id DESC)
-- +goose StatementEnd
