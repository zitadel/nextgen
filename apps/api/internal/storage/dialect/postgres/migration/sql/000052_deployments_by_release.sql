-- +goose Up
-- GET /deployments?release_id= reads one release's deployments newest first,
-- without walking the project's whole history.
CREATE INDEX IF NOT EXISTS idx_deployments_project_release_deployed_at
    ON zitadel_nextgen.deployments (project_id, release_id, deployed_at DESC, id DESC);

-- +goose Down
DROP INDEX IF EXISTS zitadel_nextgen.idx_deployments_project_release_deployed_at;
