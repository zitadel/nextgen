-- +goose Up
-- +goose StatementBegin
-- One immutable revision of a project's OAuth settings; see the postgres
-- migration. created_at is unix nanos stamped in Go, as everywhere else in
-- this dialect.
CREATE TABLE oauth_settings (
    project_id  TEXT    NOT NULL,
    id          TEXT    NOT NULL,
    definition  TEXT    NOT NULL,
    created_at  INTEGER NOT NULL,
    PRIMARY KEY (project_id, id),
    CONSTRAINT chk_oauth_settings_id CHECK (id <> ''),
    CONSTRAINT chk_oauth_settings_definition CHECK (json_type(definition) = 'object'),
    CONSTRAINT fk_oauth_settings_project
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_oauth_settings_project_created_at
    ON oauth_settings (project_id, created_at DESC, id DESC);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_oauth_settings_project_created_at;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS oauth_settings;
-- +goose StatementEnd
