-- +goose Up
-- What delivery keeps on a webhook (ADR 088 §4), beside the cursor.
-- next_attempt_at: from when the next attempt is due, the end of the backoff
-- after a failure; NULL is due. failing_since: the first failure since the
-- last delivery that succeeded. lease_holder and lease_expires_at: the server
-- delivering the webhook, and until when, so that replicas do not each send
-- every event.
ALTER TABLE zitadel_nextgen.webhooks
    ADD COLUMN next_attempt_at TIMESTAMPTZ
    , ADD COLUMN failing_since TIMESTAMPTZ
    , ADD COLUMN lease_holder TEXT
    , ADD COLUMN lease_expires_at TIMESTAMPTZ;

-- +goose Down
ALTER TABLE zitadel_nextgen.webhooks
    DROP COLUMN IF EXISTS lease_expires_at
    , DROP COLUMN IF EXISTS lease_holder
    , DROP COLUMN IF EXISTS failing_since
    , DROP COLUMN IF EXISTS next_attempt_at;
