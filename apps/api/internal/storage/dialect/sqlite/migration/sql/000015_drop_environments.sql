-- +goose Up
-- See the postgres migration. SQLite drops neither a key column nor a foreign
-- key in place, and nothing stored is kept, so variables and deployments are
-- recreated without their reference to environments before that table goes.
-- +goose StatementBegin
DROP TABLE variables;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE variables (
    name         TEXT    NOT NULL CHECK (name <> ''),
    project_id   TEXT    NOT NULL CHECK (project_id <> ''),
    value        TEXT    NOT NULL,
    is_secret    INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL,
    modified_at  INTEGER NOT NULL,
    PRIMARY KEY (name, project_id),
    FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_variables_project_name ON variables (project_id, name);
-- +goose StatementEnd

-- +goose StatementBegin
DROP TABLE deployments;
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

-- +goose StatementBegin
DROP TABLE environments;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
CREATE TABLE environments (
    project_id             TEXT    NOT NULL,
    id                     TEXT    NOT NULL,
    name                   TEXT    NOT NULL,
    created_at             INTEGER NOT NULL,
    current_deployment_id  TEXT,
    PRIMARY KEY (project_id, id),
    CONSTRAINT chk_environments_name CHECK (name <> '' AND length(name) <= 63),
    CONSTRAINT fk_environments_project
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX uq_environments_project_name ON environments (project_id, name);
-- +goose StatementEnd

-- +goose StatementBegin
DROP TABLE deployments;
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
    CONSTRAINT fk_deployments_environment
        FOREIGN KEY (project_id, environment_id)
        REFERENCES environments (project_id, id) ON DELETE CASCADE,
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

-- +goose StatementBegin
DROP TABLE variables;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE variables (
    name             TEXT    NOT NULL CHECK (name <> ''),
    project_id       TEXT    NOT NULL CHECK (project_id <> ''),
    environment_id   TEXT    NOT NULL DEFAULT '',
    environment_ref  TEXT    GENERATED ALWAYS AS (NULLIF(environment_id, '')) STORED,
    value            TEXT    NOT NULL,
    is_secret        INTEGER NOT NULL DEFAULT 0,
    created_at       INTEGER NOT NULL,
    modified_at      INTEGER NOT NULL,
    PRIMARY KEY (name, project_id, environment_id),
    FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
    FOREIGN KEY (project_id, environment_ref)
        REFERENCES environments (project_id, id) ON DELETE CASCADE
);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_variables_project_name ON variables (project_id, name);
-- +goose StatementEnd
