-- +goose NO TRANSACTION
-- +goose Up
-- +goose StatementBegin
-- A deployment is an immutable, project-scoped record of a release being made
-- live on an environment (ADR 035, #532). See the postgres migration for why
-- environments.current_deployment_id carries no foreign key, and why the
-- release reference cascades.
CREATE TABLE deployments (
    project_id              STRING(MAX) NOT NULL,
    id                      STRING(MAX) NOT NULL,
    environment_id          STRING(MAX) NOT NULL,
    release_id              STRING(MAX) NOT NULL,
    -- See the postgres migration for why the metadata is a document rather
    -- than columns, and why deployed_at is the exception.
    metadata                JSON        NOT NULL,
    deployed_at             TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    CONSTRAINT chk_deployments_id CHECK (id <> ''),
    CONSTRAINT fk_deployments_environment
        FOREIGN KEY (project_id, environment_id)
        REFERENCES environments (project_id, id)
        ON DELETE CASCADE,
    CONSTRAINT fk_deployments_release
        FOREIGN KEY (project_id, release_id)
        REFERENCES releases (project_id, id)
        ON DELETE CASCADE,
) PRIMARY KEY (project_id, id)
-- +goose StatementEnd
-- +goose StatementBegin
-- An environment's history lists newest-first by keyset; id breaks
-- deployed_at ties. The first row under this order is the environment's
-- current deployment.
CREATE INDEX idx_deployments_project_env_deployed_at
    ON deployments (project_id, environment_id, deployed_at DESC, id DESC)
-- +goose StatementEnd
-- +goose StatementBegin
-- The unfiltered project-wide audit list, same order without the environment.
CREATE INDEX idx_deployments_project_deployed_at
    ON deployments (project_id, deployed_at DESC, id DESC)
-- +goose StatementEnd
-- +goose StatementBegin
-- The deployment an environment currently runs; see the postgres migration.
ALTER TABLE environments ADD COLUMN current_deployment_id STRING(MAX)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
ALTER TABLE environments DROP COLUMN current_deployment_id
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_deployments_project_deployed_at
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_deployments_project_env_deployed_at
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS deployments
-- +goose StatementEnd
