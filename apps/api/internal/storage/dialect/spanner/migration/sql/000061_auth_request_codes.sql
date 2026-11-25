-- +goose NO TRANSACTION
-- +goose Up
-- See the postgres migration.
-- +goose StatementBegin
ALTER TABLE auth_requests ADD COLUMN code_hash STRING(MAX)
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE auth_requests ADD COLUMN user_id STRING(MAX)
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE auth_requests ADD COLUMN session_id STRING(MAX)
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE auth_requests ADD COLUMN code_expires_at TIMESTAMP
-- +goose StatementEnd

-- NULL_FILTERED: Spanner indexes NULL as a value, so every request without a
-- code would collide on (project_id, NULL).
-- +goose StatementBegin
CREATE UNIQUE NULL_FILTERED INDEX uq_auth_requests_code_hash
    ON auth_requests (project_id, code_hash)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
DROP INDEX IF EXISTS uq_auth_requests_code_hash
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE auth_requests DROP COLUMN code_expires_at
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE auth_requests DROP COLUMN session_id
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE auth_requests DROP COLUMN user_id
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE auth_requests DROP COLUMN code_hash
-- +goose StatementEnd
