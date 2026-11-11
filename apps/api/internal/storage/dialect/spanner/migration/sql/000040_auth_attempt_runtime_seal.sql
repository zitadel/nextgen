-- +goose NO TRANSACTION
-- +goose Up
-- See the postgres migration.
-- +goose StatementBegin
ALTER TABLE auth_attempts ADD COLUMN deployment_id STRING(MAX)
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE auth_attempts ADD COLUMN release_id STRING(MAX)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
ALTER TABLE auth_attempts DROP COLUMN deployment_id
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE auth_attempts DROP COLUMN release_id
-- +goose StatementEnd
