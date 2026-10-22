-- +goose NO TRANSACTION
-- +goose Up
-- +goose StatementBegin
CREATE TABLE user_agents (
    project_id  STRING(MAX) NOT NULL,
    id          STRING(MAX) NOT NULL,
    info        JSON        NOT NULL,
    created_at  TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    updated_at  TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
) PRIMARY KEY (project_id, id)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE sessions (
    project_id     STRING(MAX) NOT NULL,
    id             STRING(MAX) NOT NULL,
    created_at     TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    updated_at     TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    time_to_live   INT64 NOT NULL,
    expires_at     TIMESTAMP AS (TIMESTAMP_ADD(updated_at, INTERVAL time_to_live NANOSECOND)) STORED,
    token_id       STRING(MAX),
    user_id        STRING(MAX),
    user_agent_id  STRING(MAX),
    FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
    CONSTRAINT fk_sessions_user
        FOREIGN KEY (project_id, user_id)
        REFERENCES users(project_id, id) ON DELETE CASCADE,
    FOREIGN KEY (project_id, user_agent_id) REFERENCES user_agents (project_id, id)
) PRIMARY KEY (project_id, id)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE NULL_FILTERED INDEX idx_sessions_token
    ON sessions (project_id, token_id)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_sessions_token
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS sessions
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS user_agents
-- +goose StatementEnd
