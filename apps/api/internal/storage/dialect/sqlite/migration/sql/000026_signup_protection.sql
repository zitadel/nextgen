-- +goose Up
-- +goose StatementBegin
CREATE TABLE signup_challenges (
    project_id TEXT NOT NULL,
    flow_id TEXT NOT NULL,
    id TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    payload TEXT NOT NULL,
    public TEXT NOT NULL,
    CONSTRAINT fk_signup_challenges_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
    PRIMARY KEY (project_id, flow_id)
);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE signup_limits (
    project_id TEXT NOT NULL,
    flow_id TEXT NOT NULL,
    window_start INTEGER NOT NULL,
    issued INTEGER NOT NULL,
    verified INTEGER NOT NULL,
    CONSTRAINT fk_signup_limits_project FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
    PRIMARY KEY (project_id, flow_id)
);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_signup_challenges_project_expires_at ON signup_challenges (project_id, expires_at);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_signup_limits_project_window_start ON signup_limits (project_id, window_start);
-- +goose StatementEnd
-- +goose Down
-- +goose StatementBegin
DROP TABLE signup_limits;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE signup_challenges;
-- +goose StatementEnd
