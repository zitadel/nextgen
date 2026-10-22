-- +goose Up
-- The hashing method a project's passwords are written with (ADR 029
-- §Hashing). Nullable on purpose: NULL is "this project never chose one", which
-- is what makes the deployment default apply, and is the only value that can
-- mean that -- a default of '{}' would be an answer, and an answer naming no
-- algorithm. Verification is unaffected; the column only steers new hashes.
ALTER TABLE zitadel_nextgen.projects
    ADD COLUMN password_hash_policy JSONB
        CHECK (password_hash_policy IS NULL OR jsonb_typeof(password_hash_policy) = 'object');

-- +goose Down
ALTER TABLE zitadel_nextgen.projects DROP COLUMN password_hash_policy;
