-- +goose NO TRANSACTION
-- +goose Up
-- See the postgres migration.
-- +goose StatementBegin
ALTER TABLE auth_attempts ADD COLUMN flow_id STRING(MAX)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
ALTER TABLE auth_attempts DROP COLUMN flow_id
-- +goose StatementEnd
