-- +goose NO TRANSACTION
-- +goose Up
-- +goose StatementBegin
CREATE TABLE checks (
    project_id          STRING(MAX) NOT NULL,
    id                  STRING(MAX) NOT NULL,
    auth_attempt_id     STRING(MAX),
    session_id          STRING(MAX),
    type                INT64  NOT NULL,

    last_challenged_at  TIMESTAMP,
    last_verified_at    TIMESTAMP,
    last_failed_at      TIMESTAMP,
    failure_count       INT64   NOT NULL DEFAULT (0),

    challenge_payload   JSON,
    factor_payload      JSON,
    FOREIGN KEY (project_id, auth_attempt_id) REFERENCES auth_attempts (project_id, id) ON DELETE CASCADE,
    FOREIGN KEY (project_id, session_id) REFERENCES sessions (project_id, id) ON DELETE CASCADE,
) PRIMARY KEY (project_id, id)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX idx_checks_auth_attempt_type
    ON checks (project_id, auth_attempt_id, type)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_checks_session
    ON checks (project_id, session_id)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_checks_session
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_checks_auth_attempt_type
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS checks
-- +goose StatementEnd
