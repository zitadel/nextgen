-- +goose NO TRANSACTION
-- +goose Up
-- +goose StatementBegin
CREATE TABLE auth_attempts (
    project_id      STRING(MAX) NOT NULL,
    id              STRING(MAX) NOT NULL,
    handoff_token   BYTES(32),
    handed_off_at   TIMESTAMP,
    session_id      STRING(MAX),
    required_checks ARRAY<INT64>,
    created_at      TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    time_to_live    INT64,
    FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
) PRIMARY KEY (project_id, id)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE NULL_FILTERED INDEX idx_auth_attempts_handoff_token
    ON auth_attempts (project_id, handoff_token)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_auth_attempts_handoff_token
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS auth_attempts
-- +goose StatementEnd
