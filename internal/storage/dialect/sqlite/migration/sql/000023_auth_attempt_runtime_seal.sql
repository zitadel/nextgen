-- +goose Up
-- See the postgres migration.
-- +goose StatementBegin
ALTER TABLE auth_attempts ADD COLUMN deployment_id TEXT;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE auth_attempts ADD COLUMN release_id TEXT;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE auth_attempts DROP COLUMN deployment_id;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE auth_attempts DROP COLUMN release_id;
-- +goose StatementEnd
