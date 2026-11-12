-- +goose Up
-- The login flow that created the attempt, so the handoff exchange can stamp
-- flow_id on the session and token events it writes (ADR 048 §2). NULL for an
-- attempt created outside a flow.
ALTER TABLE zitadel_nextgen.auth_attempts
    ADD COLUMN flow_id TEXT COLLATE "C";

-- +goose Down
ALTER TABLE zitadel_nextgen.auth_attempts
    DROP COLUMN IF EXISTS flow_id;
