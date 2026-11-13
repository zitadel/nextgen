-- +goose Up
-- See the postgres migration. SQLite can't add a CHECK to an existing table,
-- so only the statement keeps rejected_at in step with status.
-- +goose StatementBegin
ALTER TABLE invitations ADD COLUMN rejected_at INTEGER;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE invitations DROP COLUMN rejected_at;
-- +goose StatementEnd
