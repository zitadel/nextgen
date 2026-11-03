-- +goose Up
-- +goose StatementBegin
-- One row per password instead of per user; see the postgres migration. A
-- row's created_at becomes when its password was set, which changed_at held.
UPDATE user_passwords SET created_at = changed_at;
-- +goose StatementEnd

-- +goose StatementBegin
DROP INDEX idx_user_passwords_user;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE user_passwords DROP COLUMN changed_at;
-- +goose StatementEnd

-- +goose StatementBegin
-- Rules out two passwords of one user with the same stamp; see the postgres
-- migration. SetUserPassword stamps unix nanos in Go, as everywhere else in
-- this dialect.
CREATE UNIQUE INDEX uq_user_passwords_user_created_at
    ON user_passwords (project_id, user_id, created_at);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS uq_user_passwords_user_created_at;
-- +goose StatementEnd
-- +goose StatementBegin
-- Only the current password survives the way back.
DELETE FROM user_passwords
WHERE EXISTS (
    SELECT 1 FROM user_passwords AS newer
    WHERE newer.project_id = user_passwords.project_id
        AND newer.user_id = user_passwords.user_id
        AND newer.created_at > user_passwords.created_at
);
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE user_passwords ADD COLUMN changed_at INTEGER NOT NULL DEFAULT (0);
-- +goose StatementEnd
-- +goose StatementBegin
UPDATE user_passwords SET changed_at = created_at;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX idx_user_passwords_user ON user_passwords (project_id, user_id);
-- +goose StatementEnd
