-- +goose NO TRANSACTION
-- +goose Up
-- +goose StatementBegin
CREATE TABLE signup_challenges (
    project_id STRING(MAX) NOT NULL,
    flow_id STRING(MAX) NOT NULL,
    id STRING(MAX) NOT NULL,
    expires_at INT64 NOT NULL,
    payload STRING(MAX) NOT NULL,
    public STRING(MAX) NOT NULL,
    CONSTRAINT fk_signup_challenges_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
) PRIMARY KEY (project_id, flow_id)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE signup_limits (
    project_id STRING(MAX) NOT NULL,
    flow_id STRING(MAX) NOT NULL,
    window_start INT64 NOT NULL,
    issued INT64 NOT NULL,
    verified INT64 NOT NULL,
    CONSTRAINT fk_signup_limits_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
) PRIMARY KEY (project_id, flow_id)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_signup_challenges_project_expires_at ON signup_challenges (project_id, expires_at)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_signup_limits_project_window_start ON signup_limits (project_id, window_start)
-- +goose StatementEnd
-- +goose Down
-- +goose StatementBegin
DROP INDEX idx_signup_challenges_project_expires_at
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX idx_signup_limits_project_window_start
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE signup_limits
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE signup_challenges
-- +goose StatementEnd
