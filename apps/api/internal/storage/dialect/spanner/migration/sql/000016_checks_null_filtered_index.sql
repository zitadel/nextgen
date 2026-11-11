-- +goose NO TRANSACTION
-- +goose Up
-- Spanner unique indexes treat NULL as an indexable value (unlike Postgres,
-- where NULLs are distinct), so session-bound checks (auth_attempt_id IS NULL)
-- collide on (project_id, NULL, type). NULL_FILTERED restores the intended
-- semantics: uniqueness applies only to attempt-bound checks.
-- +goose StatementBegin
DROP INDEX idx_checks_auth_attempt_type
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE NULL_FILTERED INDEX idx_checks_auth_attempt_type
    ON checks (project_id, auth_attempt_id, type)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_checks_auth_attempt_type
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX idx_checks_auth_attempt_type
    ON checks (project_id, auth_attempt_id, type)
-- +goose StatementEnd
