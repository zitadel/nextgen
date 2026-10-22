-- +goose NO TRANSACTION
-- +goose Up
-- +goose StatementBegin
-- One row per password instead of per user; see the postgres migration. A
-- row's created_at becomes when its password was set, which changed_at held.
UPDATE user_passwords SET created_at = changed_at WHERE TRUE
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX idx_user_passwords_user
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE user_passwords DROP COLUMN changed_at
-- +goose StatementEnd
-- +goose StatementBegin
-- Rules out two passwords of one user with the same stamp; see the postgres
-- migration. The direction does not change what the index holds unique.
CREATE UNIQUE INDEX uq_user_passwords_user_created_at
    ON user_passwords (project_id, user_id, created_at DESC)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
DROP INDEX IF EXISTS uq_user_passwords_user_created_at
-- +goose StatementEnd
-- +goose StatementBegin
-- Only the current password survives the way back.
DELETE FROM user_passwords p
WHERE EXISTS (
    SELECT 1 FROM user_passwords newer
    WHERE newer.project_id = p.project_id
        AND newer.user_id = p.user_id
        AND newer.created_at > p.created_at
)
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE user_passwords ADD COLUMN changed_at TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP())
-- +goose StatementEnd
-- +goose StatementBegin
UPDATE user_passwords SET changed_at = created_at WHERE TRUE
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX idx_user_passwords_user
    ON user_passwords (project_id, user_id)
-- +goose StatementEnd
