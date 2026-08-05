-- +goose NO TRANSACTION
-- +goose Up
-- revoked_at marks a session as explicitly revoked (soft delete). NULL means
-- the session was never revoked. It is independent of the generated expires_at
-- column, so revoking a session does not change its expiry.
-- +goose StatementBegin
ALTER TABLE sessions ADD COLUMN revoked_at TIMESTAMP
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
ALTER TABLE sessions DROP COLUMN revoked_at
-- +goose StatementEnd
