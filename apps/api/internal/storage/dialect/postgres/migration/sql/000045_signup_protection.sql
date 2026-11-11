-- +goose Up
-- +goose StatementBegin
CREATE TABLE zitadel_nextgen.signup_challenges (
    project_id TEXT COLLATE "C" NOT NULL,
    flow_id TEXT COLLATE "C" NOT NULL,
    id TEXT COLLATE "C" NOT NULL,
    expires_at BIGINT NOT NULL,
    payload TEXT COLLATE "C" NOT NULL,
    public TEXT COLLATE "C" NOT NULL,
    CONSTRAINT fk_signup_challenges_project FOREIGN KEY (project_id) REFERENCES zitadel_nextgen.projects (id) ON DELETE CASCADE,
    PRIMARY KEY (project_id, flow_id)
);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE zitadel_nextgen.signup_limits (
    project_id TEXT COLLATE "C" NOT NULL,
    flow_id TEXT COLLATE "C" NOT NULL,
    window_start BIGINT NOT NULL,
    issued BIGINT NOT NULL,
    verified BIGINT NOT NULL,
    CONSTRAINT fk_signup_limits_project FOREIGN KEY (project_id) REFERENCES zitadel_nextgen.projects (id) ON DELETE CASCADE,
    PRIMARY KEY (project_id, flow_id)
);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_signup_challenges_project_expires_at ON zitadel_nextgen.signup_challenges (project_id, expires_at);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_signup_limits_project_window_start ON zitadel_nextgen.signup_limits (project_id, window_start);
-- +goose StatementEnd
-- +goose Down
-- +goose StatementBegin
DROP TABLE zitadel_nextgen.signup_limits;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE zitadel_nextgen.signup_challenges;
-- +goose StatementEnd
