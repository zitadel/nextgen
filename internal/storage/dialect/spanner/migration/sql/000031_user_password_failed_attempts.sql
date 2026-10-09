-- +goose NO TRANSACTION
-- +goose Up
-- +goose StatementBegin
-- One row per wrong password; see the postgres migration.
CREATE TABLE user_password_failures (
    project_id STRING(MAX) NOT NULL,
    id         STRING(MAX) NOT NULL,
    user_id    STRING(MAX) NOT NULL,
    failed_at  TIMESTAMP   NOT NULL,
    CONSTRAINT chk_user_password_failures_id CHECK (id <> ''),
    CONSTRAINT fk_user_password_failures_user
        FOREIGN KEY (project_id, user_id)
        REFERENCES users (project_id, id)
        ON DELETE CASCADE,
) PRIMARY KEY (project_id, id)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_user_password_failures_user_failed_at
    ON user_password_failures (project_id, user_id, failed_at)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_user_password_failures_user_failed_at
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS user_password_failures
-- +goose StatementEnd
