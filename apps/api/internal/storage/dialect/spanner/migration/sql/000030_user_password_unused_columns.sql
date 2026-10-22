-- +goose NO TRANSACTION
-- +goose Up
-- +goose StatementBegin
-- Nothing reads these; see the postgres migration.
ALTER TABLE user_passwords DROP CONSTRAINT chk_user_passwords_failed_attempts
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE user_passwords DROP COLUMN change_required
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE user_passwords DROP COLUMN verification_id
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE user_passwords DROP COLUMN last_successful_check
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE user_passwords DROP COLUMN failed_attempts
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE user_passwords DROP COLUMN updated_at
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
ALTER TABLE user_passwords ADD COLUMN change_required BOOL NOT NULL DEFAULT (FALSE)
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE user_passwords ADD COLUMN verification_id STRING(MAX)
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE user_passwords ADD COLUMN last_successful_check TIMESTAMP
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE user_passwords ADD COLUMN failed_attempts INT64 NOT NULL DEFAULT (0)
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE user_passwords ADD CONSTRAINT chk_user_passwords_failed_attempts CHECK (failed_attempts >= 0)
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE user_passwords ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP())
-- +goose StatementEnd
-- +goose StatementBegin
UPDATE user_passwords SET updated_at = created_at WHERE TRUE
-- +goose StatementEnd
