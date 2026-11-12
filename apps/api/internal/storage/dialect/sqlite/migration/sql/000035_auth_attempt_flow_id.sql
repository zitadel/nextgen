-- +goose Up
-- See the postgres migration.
-- +goose StatementBegin
ALTER TABLE auth_attempts ADD COLUMN flow_id TEXT;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE auth_attempts DROP COLUMN flow_id;
-- +goose StatementEnd
