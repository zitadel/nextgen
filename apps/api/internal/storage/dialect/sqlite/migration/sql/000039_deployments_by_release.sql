-- +goose Up
-- See the postgres peer (000052_deployments_by_release.sql).
-- +goose StatementBegin
CREATE INDEX idx_deployments_project_release_deployed_at
    ON deployments (project_id, release_id, deployed_at DESC, id DESC);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_deployments_project_release_deployed_at;
-- +goose StatementEnd
