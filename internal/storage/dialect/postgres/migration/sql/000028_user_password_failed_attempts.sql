-- +goose Up
-- Failed password attempts slow down further checks of the password (#1356).
-- They count on the current password row: setting a new password starts it
-- clean. last_failed_at drives both the backoff and the decay that restarts
-- the count; see domain.UserPassword.RetryAt.
ALTER TABLE zitadel_nextgen.user_passwords
    ADD COLUMN failed_attempts SMALLINT NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
    ADD COLUMN last_failed_at TIMESTAMPTZ;

-- +goose Down
ALTER TABLE zitadel_nextgen.user_passwords
    DROP COLUMN failed_attempts,
    DROP COLUMN last_failed_at;
