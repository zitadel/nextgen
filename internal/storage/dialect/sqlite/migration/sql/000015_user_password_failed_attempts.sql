-- +goose Up
-- +goose StatementBegin
-- One row per wrong password; see the postgres migration. failed_at is unix
-- nanos stamped in Go, as everywhere else in this dialect.
CREATE TABLE user_password_failures (
    project_id TEXT    NOT NULL,
    id         TEXT    NOT NULL,
    user_id    TEXT    NOT NULL,
    failed_at  INTEGER NOT NULL,
    PRIMARY KEY (project_id, id),
    CONSTRAINT chk_user_password_failures_id CHECK (id <> ''),
    CONSTRAINT fk_user_password_failures_user
        FOREIGN KEY (project_id, user_id)
        REFERENCES users (project_id, id) ON DELETE CASCADE
);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_user_password_failures_user_failed_at
    ON user_password_failures (project_id, user_id, failed_at);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_user_password_failures_user_failed_at;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS user_password_failures;
-- +goose StatementEnd
