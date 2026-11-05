-- +goose Up
-- Nothing reads these; see the postgres migration. SQLite cannot drop
-- failed_attempts while a table CHECK names it, so the table is rebuilt.
-- Nothing references user_passwords, so the swap leaves no dangling key.
-- +goose StatementBegin
CREATE TABLE user_passwords_new (
    project_id   TEXT    NOT NULL,
    id           TEXT    NOT NULL,
    user_id      TEXT    NOT NULL,
    encoded_hash TEXT    NOT NULL,
    created_at   INTEGER NOT NULL,
    PRIMARY KEY (project_id, id),
    CONSTRAINT chk_user_passwords_id CHECK (id <> ''),
    CONSTRAINT chk_user_passwords_encoded_hash CHECK (encoded_hash <> ''),
    CONSTRAINT fk_user_passwords_user
        FOREIGN KEY (project_id, user_id) REFERENCES users (project_id, id) ON DELETE CASCADE
);
-- +goose StatementEnd
-- +goose StatementBegin
INSERT INTO user_passwords_new (project_id, id, user_id, encoded_hash, created_at)
SELECT project_id, id, user_id, encoded_hash, created_at FROM user_passwords;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE user_passwords;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE user_passwords_new RENAME TO user_passwords;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX uq_user_passwords_user_created_at
    ON user_passwords (project_id, user_id, created_at);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE user_passwords ADD COLUMN change_required INTEGER NOT NULL DEFAULT (0);
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE user_passwords ADD COLUMN verification_id TEXT;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE user_passwords ADD COLUMN last_successful_check INTEGER;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE user_passwords ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT (0)
    CONSTRAINT chk_user_passwords_failed_attempts CHECK (failed_attempts >= 0);
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE user_passwords ADD COLUMN updated_at INTEGER NOT NULL DEFAULT (0);
-- +goose StatementEnd
-- +goose StatementBegin
UPDATE user_passwords SET updated_at = created_at;
-- +goose StatementEnd
