-- +goose Up
-- The code the login issues for an authorization request (ADR 081 §8). The
-- login sets code_hash, user_id, session_id and code_expires_at once, when it
-- issues the code; they are NULL until then. Redeeming the code deletes the
-- row.
ALTER TABLE zitadel_nextgen.auth_requests
    ADD COLUMN code_hash TEXT COLLATE "C"
    , ADD COLUMN user_id TEXT COLLATE "C"
    , ADD COLUMN session_id TEXT COLLATE "C"
    , ADD COLUMN code_expires_at TIMESTAMPTZ;

-- The redemption looks a code up by its hash.
CREATE UNIQUE INDEX uq_auth_requests_code_hash
    ON zitadel_nextgen.auth_requests (project_id, code_hash);

-- +goose Down
DROP INDEX IF EXISTS zitadel_nextgen.uq_auth_requests_code_hash;
ALTER TABLE zitadel_nextgen.auth_requests
    DROP COLUMN IF EXISTS code_hash
    , DROP COLUMN IF EXISTS user_id
    , DROP COLUMN IF EXISTS session_id
    , DROP COLUMN IF EXISTS code_expires_at;
