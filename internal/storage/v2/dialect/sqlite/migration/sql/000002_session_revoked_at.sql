-- +goose Up
-- revoked_at marks a session as explicitly revoked (soft delete). NULL means
-- the session was never revoked. Stored as unix-nanoseconds, like the other
-- session timestamps.
ALTER TABLE sessions ADD COLUMN revoked_at INTEGER;

-- +goose Down
ALTER TABLE sessions DROP COLUMN revoked_at;
