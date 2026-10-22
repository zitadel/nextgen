-- +goose NO TRANSACTION
-- +goose Up
-- +goose StatementBegin
-- The hashing method a project's passwords are written with (ADR 029
-- §Hashing). Nullable on purpose: NULL is "this project never chose one", which
-- is what makes the deployment default apply, and is the only value that can
-- mean that -- a default of '{}' would be an answer, and an answer naming no
-- algorithm. Verification is unaffected; the column only steers new hashes.
ALTER TABLE projects ADD COLUMN password_hash_policy JSON
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
ALTER TABLE projects DROP COLUMN password_hash_policy
-- +goose StatementEnd
