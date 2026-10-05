-- +goose NO TRANSACTION
-- +goose Up
-- +goose StatementBegin
-- Failed password attempts; see the postgres migration.
ALTER TABLE user_passwords ADD COLUMN failed_attempts INT64 NOT NULL DEFAULT (0)
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE user_passwords ADD CONSTRAINT chk_user_passwords_failed_attempts CHECK (failed_attempts >= 0)
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE user_passwords ADD COLUMN last_failed_at TIMESTAMP
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
ALTER TABLE user_passwords DROP CONSTRAINT chk_user_passwords_failed_attempts
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE user_passwords DROP COLUMN failed_attempts
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE user_passwords DROP COLUMN last_failed_at
-- +goose StatementEnd
