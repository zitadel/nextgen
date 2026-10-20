-- +goose Up
-- Nothing reads these: lockout state, a verification link and a forced change
-- were planned for passwords but never wired up, and with a row per password
-- (000026) the only writes left were to them, which is all updated_at tracked.
-- The API still accepts is_change_required; it was never enforced.
ALTER TABLE zitadel_nextgen.user_passwords
    DROP COLUMN change_required,
    DROP COLUMN verification_id,
    DROP COLUMN last_successful_check,
    DROP COLUMN failed_attempts,
    DROP COLUMN updated_at;

-- +goose Down
ALTER TABLE zitadel_nextgen.user_passwords
    ADD COLUMN change_required BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN verification_id TEXT,
    ADD COLUMN last_successful_check TIMESTAMPTZ,
    ADD COLUMN failed_attempts SMALLINT NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
    ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
UPDATE zitadel_nextgen.user_passwords SET updated_at = created_at;
