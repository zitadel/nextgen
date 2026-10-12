-- +goose Up
-- See the postgres migration. revoked_at is unix nanos stamped in Go, as
-- everywhere else in this dialect.
-- +goose StatementBegin
ALTER TABLE releases ADD COLUMN revoked_at INTEGER;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE releases DROP COLUMN revoked_at;
-- +goose StatementEnd
