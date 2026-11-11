-- +goose NO TRANSACTION
-- +goose Up
-- See the postgres migration.
-- +goose StatementBegin
ALTER TABLE releases ADD COLUMN revoked_at TIMESTAMP
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
ALTER TABLE releases DROP COLUMN revoked_at
-- +goose StatementEnd
