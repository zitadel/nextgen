-- +goose Up
-- Seal the deployment and release that served createAuthAttempt so later
-- attempt ops and handoff exchange reuse that pointer (runtime resolution).
ALTER TABLE zitadel_nextgen.auth_attempts
    ADD COLUMN deployment_id TEXT COLLATE "C",
    ADD COLUMN release_id TEXT COLLATE "C";

-- +goose Down
ALTER TABLE zitadel_nextgen.auth_attempts
    DROP COLUMN IF EXISTS deployment_id,
    DROP COLUMN IF EXISTS release_id;
