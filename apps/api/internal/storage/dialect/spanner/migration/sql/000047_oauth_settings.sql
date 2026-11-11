-- +goose NO TRANSACTION
-- +goose Up
-- One immutable revision of a project's OAuth settings; see the postgres
-- migration.
-- +goose StatementBegin
CREATE TABLE oauth_settings (
    project_id  STRING(MAX) NOT NULL,
    id          STRING(MAX) NOT NULL,
    definition  JSON        NOT NULL,
    created_at  TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    CONSTRAINT chk_oauth_settings_id CHECK (id <> ''),
    CONSTRAINT fk_oauth_settings_project
        FOREIGN KEY (project_id)
        REFERENCES projects (id)
        ON DELETE CASCADE
) PRIMARY KEY (project_id, id)
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_oauth_settings_project_created_at
    ON oauth_settings (project_id, created_at DESC, id DESC)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_oauth_settings_project_created_at
-- +goose StatementEnd

-- +goose StatementBegin
DROP TABLE IF EXISTS oauth_settings
-- +goose StatementEnd
