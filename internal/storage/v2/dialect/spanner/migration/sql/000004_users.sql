-- +goose NO TRANSACTION
-- +goose Up
-- +goose StatementBegin
CREATE TABLE users (
    project_id  STRING(MAX) NOT NULL,
    team_id     STRING(MAX) NOT NULL,
    id          STRING(MAX) NOT NULL,
    created_at  TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    updated_at  TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    schema_url  STRING(MAX) NOT NULL,
    CONSTRAINT fk_users_project
        FOREIGN KEY (project_id)
        REFERENCES projects (id)
        ON DELETE CASCADE,
    CONSTRAINT fk_users_team
        FOREIGN KEY (project_id, team_id)
        REFERENCES teams (project_id, id)
        ON DELETE CASCADE,
) PRIMARY KEY (project_id, id)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_users_team_id
    ON users (team_id)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE user_attributes (
    project_id  STRING(MAX) NOT NULL,
    team_id     STRING(MAX) NOT NULL,
    user_id     STRING(MAX) NOT NULL,
    key         STRING(MAX) NOT NULL,
    value       JSON        NOT NULL,
    CONSTRAINT fk_user_attributes_user
        FOREIGN KEY (project_id, user_id)
        REFERENCES users (project_id, id)
        ON DELETE CASCADE,
) PRIMARY KEY (project_id, user_id, key)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_user_attributes_scalar
    ON user_attributes (key, team_id)
    STORING (value)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_user_attributes_team_id
    ON user_attributes (team_id)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE user_unique_attributes (
    project_id  STRING(MAX) NOT NULL,
    user_id     STRING(MAX) NOT NULL,
    team_id     STRING(MAX) NOT NULL,
    key         STRING(MAX) NOT NULL,
    value_hash  BYTES(32)   NOT NULL,
    CONSTRAINT fk_user_unique_attributes_user
        FOREIGN KEY (project_id, user_id)
        REFERENCES users (project_id, id)
        ON DELETE CASCADE,
) PRIMARY KEY (project_id, team_id, key, value_hash)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
DROP TABLE IF EXISTS user_unique_attributes
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS user_attributes
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS users
-- +goose StatementEnd
