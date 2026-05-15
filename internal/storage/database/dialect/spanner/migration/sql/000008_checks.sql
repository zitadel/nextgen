-- +goose NO TRANSACTION
-- +goose Up
-- +goose StatementBegin
CREATE TABLE checks (
    project_id              STRING(MAX) NOT NULL,
    id                      STRING(MAX) NOT NULL,
    auth_attempt_id         STRING(MAX),
    session_id              STRING(MAX),
    type                    INT64       NOT NULL,
    user_password_id        INT64,
    user_totp_id            INT64,
    user_passkey_id         INT64,
    user_recovery_codes_id  INT64,
    started_at              TIMESTAMP,
    succeeded_at            TIMESTAMP,
    failed_at               TIMESTAMP,
    handedoff_at            TIMESTAMP,
    failure_count           INT64       NOT NULL DEFAULT (0),
    challenge               JSON,
    factor                  JSON,
    supersedes              STRING(MAX),
    FOREIGN KEY (project_id, auth_attempt_id) REFERENCES auth_attempts (project_id, id) ON DELETE CASCADE,
    FOREIGN KEY (project_id, session_id) REFERENCES sessions (project_id, id) ON DELETE CASCADE,
    FOREIGN KEY (project_id, supersedes) REFERENCES checks (project_id, id),
    FOREIGN KEY (user_password_id) REFERENCES user_passwords (id),
    FOREIGN KEY (user_totp_id) REFERENCES user_totp (id),
    FOREIGN KEY (user_passkey_id) REFERENCES user_passkeys (id),
    FOREIGN KEY (user_recovery_codes_id) REFERENCES user_recovery_codes (id),
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
