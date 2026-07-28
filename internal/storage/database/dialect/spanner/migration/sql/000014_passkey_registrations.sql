-- +goose NO TRANSACTION
-- +goose Up
-- +goose StatementBegin
CREATE TABLE passkey_registrations (
    id          STRING(MAX) NOT NULL,
    project_id  STRING(MAX) NOT NULL,
    user_id     STRING(MAX) NOT NULL,
    challenge   JSON        NOT NULL,
    expires_at  TIMESTAMP   NOT NULL,
    created_at  TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    CONSTRAINT fk_passkey_registrations_project
        FOREIGN KEY (project_id)
        REFERENCES projects (id)
        ON DELETE CASCADE
) PRIMARY KEY (id)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_passkey_registrations_expires_at
    ON passkey_registrations (expires_at)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_passkey_registrations_expires_at
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS passkey_registrations
-- +goose StatementEnd
