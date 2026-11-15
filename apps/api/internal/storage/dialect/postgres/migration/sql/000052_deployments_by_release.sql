-- +goose NO TRANSACTION
-- +goose Up
-- GET /deployments?release_id= reads one release's deployments newest first,
-- without walking the project's whole history.
--
-- CONCURRENTLY and the DROP before the CREATE are as in 000051: a plain build
-- would block every project's deploys and rollbacks while the previous server
-- still serves, and a rerun after a failed build must converge.
DROP INDEX IF EXISTS zitadel_nextgen.idx_deployments_project_release_deployed_at;
CREATE INDEX CONCURRENTLY idx_deployments_project_release_deployed_at
    ON zitadel_nextgen.deployments (project_id, release_id, deployed_at DESC, id DESC);

-- +goose Down
DROP INDEX CONCURRENTLY IF EXISTS zitadel_nextgen.idx_deployments_project_release_deployed_at;
