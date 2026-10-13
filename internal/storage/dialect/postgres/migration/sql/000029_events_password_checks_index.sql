-- +goose Up
-- Wrong passwords slow down further checks of a user's password (#1356). The
-- rate limit counts the user's auth.check.failed events of password checks
-- since their last auth.check.succeeded one, by the payload's user_id; see
-- domain.UserPasswordFailures. Partial, so only password check events (and
-- direct password factors) are indexed, not the rest of the audit stream.
CREATE INDEX idx_events_password_checks
    ON zitadel_nextgen.events (project_id, (payload->>'user_id'), event_type, created_at)
    WHERE payload->>'check_type' = 'Password';

-- +goose Down
DROP INDEX IF EXISTS zitadel_nextgen.idx_events_password_checks;
