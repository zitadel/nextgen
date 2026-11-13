-- +goose NO TRANSACTION
-- +goose Up
-- See the postgres peer (000052_deployment_origins_expires_at.sql).
-- +goose StatementBegin
ALTER TABLE deployment_origins ADD COLUMN expires_at TIMESTAMP
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
ALTER TABLE deployment_origins DROP COLUMN expires_at
-- +goose StatementEnd
