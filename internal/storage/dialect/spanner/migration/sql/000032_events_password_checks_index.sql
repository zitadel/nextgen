-- +goose NO TRANSACTION
-- +goose Up
-- +goose StatementBegin
-- The password rate limit's index; see the postgres migration. Spanner cannot
-- index an expression, so the payload's user_id is a generated column, NULL
-- on everything but password check events, and the index skips the NULLs.
ALTER TABLE events ADD COLUMN password_check_user_id STRING(MAX) AS (
    IF(JSON_VALUE(payload, '$.check_type') = 'Password', JSON_VALUE(payload, '$.user_id'), NULL)
) STORED
-- +goose StatementEnd
-- +goose StatementBegin
CREATE NULL_FILTERED INDEX idx_events_password_checks
    ON events (project_id, password_check_user_id, event_type, created_at)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_events_password_checks
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE events DROP COLUMN password_check_user_id
-- +goose StatementEnd
