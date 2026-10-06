-- +goose Up
-- Deployments key on an origin string rather than on an environment row; see
-- the postgres migration. Timestamps are unix nanos stamped in Go, as
-- everywhere else in this dialect.
-- +goose StatementBegin
DROP TABLE IF EXISTS deployments;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS variables;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS environments;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE projects DROP COLUMN preview_origins;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE projects ADD COLUMN allowed_origins TEXT NOT NULL DEFAULT '[]';
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE projects ADD COLUMN class TEXT NOT NULL DEFAULT 'sandbox'
    CHECK (class IN ('sandbox', 'production'));
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE releases ADD COLUMN revoked_at INTEGER;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE origins (
    project_id  TEXT    NOT NULL,
    origin      TEXT    NOT NULL,
    expires_at  INTEGER NOT NULL,
    created_at  INTEGER NOT NULL,
    PRIMARY KEY (project_id, origin),
    CONSTRAINT chk_origins_origin CHECK (origin <> ''),
    CONSTRAINT fk_origins_project
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_origins_expires_at ON origins (expires_at);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE deployments (
    project_id   TEXT    NOT NULL,
    id           TEXT    NOT NULL,
    deploy_id    TEXT    NOT NULL,
    origin       TEXT    NOT NULL DEFAULT '',
    release_id   TEXT    NOT NULL,
    metadata     TEXT    NOT NULL,
    deployed_at  INTEGER NOT NULL,
    PRIMARY KEY (project_id, id),
    CONSTRAINT chk_deployments_id CHECK (id <> ''),
    CONSTRAINT chk_deployments_deploy_id CHECK (deploy_id <> ''),
    CONSTRAINT chk_deployments_metadata CHECK (json_type(metadata) = 'object'),
    CONSTRAINT fk_deployments_project
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
    -- NO ACTION: see the postgres migration. SQLite checks an immediate
    -- constraint at the end of the statement, so a project delete that
    -- cascades both tables away in one statement passes whichever it
    -- reaches first, while a direct delete of a deployed release fails.
    CONSTRAINT fk_deployments_release
        FOREIGN KEY (project_id, release_id)
        REFERENCES releases (project_id, id) ON DELETE NO ACTION
);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_deployments_project_origin_deployed_at
    ON deployments (project_id, origin, deployed_at DESC, id DESC);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_deployments_project_deploy_id
    ON deployments (project_id, deploy_id);
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_deployments_project_deployed_at
    ON deployments (project_id, deployed_at DESC, id DESC);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE variables (
    project_id   TEXT    NOT NULL CHECK (project_id <> ''),
    name         TEXT    NOT NULL CHECK (name <> ''),
    applies_to   TEXT    NOT NULL DEFAULT 'all' CHECK (applies_to IN ('all', 'preview')),
    value        TEXT    NOT NULL,
    is_secret    INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL,
    modified_at  INTEGER NOT NULL,
    PRIMARY KEY (project_id, name, applies_to),
    FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE deployment_variables (
    project_id     TEXT    NOT NULL,
    deployment_id  TEXT    NOT NULL,
    name           TEXT    NOT NULL CHECK (name <> ''),
    value          TEXT    NOT NULL,
    is_secret      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (project_id, deployment_id, name),
    FOREIGN KEY (project_id, deployment_id)
        REFERENCES deployments (project_id, id) ON DELETE CASCADE
);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS deployment_variables;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS variables;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS deployments;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS origins;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE releases DROP COLUMN revoked_at;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE projects DROP COLUMN class;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE projects DROP COLUMN allowed_origins;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE projects ADD COLUMN preview_origins TEXT NOT NULL DEFAULT '[]';
-- +goose StatementEnd
