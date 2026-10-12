-- +goose Up
-- See the postgres migration. Timestamps are unix nanos stamped in Go, as
-- everywhere else in this dialect.
-- +goose StatementBegin
DROP TABLE deployments;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE deployments (
    project_id   TEXT    NOT NULL,
    id           TEXT    NOT NULL,
    release_id   TEXT    NOT NULL,
    target_kind  TEXT    NOT NULL,
    metadata     TEXT    NOT NULL,
    deployed_at  INTEGER NOT NULL,
    PRIMARY KEY (project_id, id),
    CONSTRAINT chk_deployments_id CHECK (id <> ''),
    CONSTRAINT chk_deployments_target_kind CHECK (target_kind IN ('primary', 'preview')),
    CONSTRAINT chk_deployments_metadata CHECK (json_type(metadata) = 'object'),
    CONSTRAINT fk_deployments_project
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
    -- See the postgres migration for why this is NO ACTION.
    CONSTRAINT fk_deployments_release
        FOREIGN KEY (project_id, release_id) REFERENCES releases (project_id, id)
);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_deployments_project_deployed_at
    ON deployments (project_id, deployed_at DESC, id DESC);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE deployment_targets (
    project_id     TEXT    NOT NULL,
    deployment_id  TEXT    NOT NULL,
    origin         TEXT    NOT NULL,
    release_id     TEXT    NOT NULL,
    deployed_at    INTEGER NOT NULL,
    PRIMARY KEY (project_id, deployment_id, origin),
    CONSTRAINT chk_deployment_targets_origin CHECK (origin <> ''),
    CONSTRAINT fk_deployment_targets_deployment
        FOREIGN KEY (project_id, deployment_id) REFERENCES deployments (project_id, id) ON DELETE CASCADE
);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_deployment_targets_origin_newest
    ON deployment_targets (project_id, origin, deployed_at DESC, deployment_id DESC);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE previews (
    project_id  TEXT    NOT NULL,
    origin      TEXT    NOT NULL,
    expires_at  INTEGER NOT NULL,
    created_at  INTEGER NOT NULL,
    PRIMARY KEY (project_id, origin),
    CONSTRAINT chk_previews_origin CHECK (origin <> ''),
    CONSTRAINT fk_previews_project
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_previews_project_created_at
    ON previews (project_id, created_at DESC, origin DESC);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_previews_project_expires_at
    ON previews (project_id, expires_at, origin);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS previews;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS deployment_targets;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS deployments;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE deployments (
    project_id              TEXT    NOT NULL,
    id                      TEXT    NOT NULL,
    environment_id          TEXT    NOT NULL,
    release_id              TEXT    NOT NULL,
    metadata                TEXT    NOT NULL,
    deployed_at             INTEGER NOT NULL,
    PRIMARY KEY (project_id, id),
    CONSTRAINT chk_deployments_id CHECK (id <> ''),
    CONSTRAINT chk_deployments_metadata CHECK (json_type(metadata) = 'object'),
    CONSTRAINT fk_deployments_release
        FOREIGN KEY (project_id, release_id)
        REFERENCES releases (project_id, id) ON DELETE CASCADE
);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_deployments_project_env_deployed_at
    ON deployments (project_id, environment_id, deployed_at DESC, id DESC);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_deployments_project_deployed_at
    ON deployments (project_id, deployed_at DESC, id DESC);
-- +goose StatementEnd
