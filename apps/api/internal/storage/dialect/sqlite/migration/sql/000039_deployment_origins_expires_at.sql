-- +goose Up
-- See the postgres peer (000052_deployment_origins_expires_at.sql). Unix
-- nanoseconds, as deployed_at is.
-- +goose StatementBegin
ALTER TABLE deployment_origins ADD COLUMN expires_at INTEGER;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE deployment_origins DROP COLUMN expires_at;
-- +goose StatementEnd
