-- +goose Up
-- +goose StatementBegin
-- The password rate limit's index; see the postgres migration.
CREATE INDEX idx_events_password_checks
    ON events (project_id, json_extract(payload, '$.user_id'), event_type, created_at)
    WHERE json_extract(payload, '$.check_type') = 'Password';
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_events_password_checks;
-- +goose StatementEnd
