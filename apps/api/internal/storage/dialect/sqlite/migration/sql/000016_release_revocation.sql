-- +goose Up
-- See the postgres migration.
-- +goose StatementBegin
ALTER TABLE releases ADD COLUMN revoked_at INTEGER;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE releases DROP COLUMN revoked_at;
-- +goose StatementEnd
