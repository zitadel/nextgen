-- +goose Up
-- revoked_at marks a session as explicitly revoked (soft delete). NULL means
-- the session was never revoked. It is independent of expires_at, so revoking
-- a session does not touch the expires_at trigger.
ALTER TABLE zitadel_nextgen.sessions ADD COLUMN revoked_at TIMESTAMPTZ;

-- +goose Down
ALTER TABLE zitadel_nextgen.sessions DROP COLUMN revoked_at;
