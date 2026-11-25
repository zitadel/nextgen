-- +goose Up
-- See the postgres migration.
-- +goose StatementBegin
ALTER TABLE auth_requests ADD COLUMN code_hash TEXT;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE auth_requests ADD COLUMN user_id TEXT;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE auth_requests ADD COLUMN session_id TEXT;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE auth_requests ADD COLUMN code_expires_at INTEGER;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE UNIQUE INDEX uq_auth_requests_code_hash ON auth_requests (project_id, code_hash);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS uq_auth_requests_code_hash;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE auth_requests DROP COLUMN code_expires_at;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE auth_requests DROP COLUMN session_id;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE auth_requests DROP COLUMN user_id;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE auth_requests DROP COLUMN code_hash;
-- +goose StatementEnd
