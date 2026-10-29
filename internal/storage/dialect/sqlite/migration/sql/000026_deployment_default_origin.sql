-- +goose Up
-- See the postgres migration. SQLite cannot drop a column CHECK, so the
-- table is rebuilt without chk_deployment_origins_origin.
-- +goose StatementBegin
CREATE TABLE deployment_origins_new (
    project_id     TEXT    NOT NULL,
    deployment_id  TEXT    NOT NULL,
    origin         TEXT    NOT NULL,
    release_id     TEXT    NOT NULL,
    origin_kind    TEXT    NOT NULL,
    deployed_at    INTEGER NOT NULL,
    seq            INTEGER NOT NULL,
    PRIMARY KEY (project_id, deployment_id, origin),
    CONSTRAINT chk_deployment_origins_seq CHECK (seq > 0),
    CONSTRAINT chk_deployment_origins_origin_kind CHECK (origin_kind IN ('primary', 'preview')),
    CONSTRAINT fk_deployment_origins_deployment
        FOREIGN KEY (project_id, deployment_id) REFERENCES deployments (project_id, id) ON DELETE CASCADE
);
-- +goose StatementEnd
-- +goose StatementBegin
INSERT INTO deployment_origins_new (project_id, deployment_id, origin, release_id, origin_kind, deployed_at, seq)
SELECT project_id, deployment_id, origin, release_id, origin_kind, deployed_at, seq FROM deployment_origins;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE deployment_origins;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE deployment_origins_new RENAME TO deployment_origins;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX uq_deployment_origins_seq
    ON deployment_origins (project_id, origin, seq);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DELETE FROM deployment_origins WHERE origin = '';
-- +goose StatementEnd
-- +goose StatementBegin
CREATE TABLE deployment_origins_old (
    project_id     TEXT    NOT NULL,
    deployment_id  TEXT    NOT NULL,
    origin         TEXT    NOT NULL,
    release_id     TEXT    NOT NULL,
    origin_kind    TEXT    NOT NULL,
    deployed_at    INTEGER NOT NULL,
    seq            INTEGER NOT NULL,
    PRIMARY KEY (project_id, deployment_id, origin),
    CONSTRAINT chk_deployment_origins_seq CHECK (seq > 0),
    CONSTRAINT chk_deployment_origins_origin_kind CHECK (origin_kind IN ('primary', 'preview')),
    CONSTRAINT chk_deployment_origins_origin CHECK (origin <> ''),
    CONSTRAINT fk_deployment_origins_deployment
        FOREIGN KEY (project_id, deployment_id) REFERENCES deployments (project_id, id) ON DELETE CASCADE
);
-- +goose StatementEnd
-- +goose StatementBegin
INSERT INTO deployment_origins_old (project_id, deployment_id, origin, release_id, origin_kind, deployed_at, seq)
SELECT project_id, deployment_id, origin, release_id, origin_kind, deployed_at, seq FROM deployment_origins;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE deployment_origins;
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE deployment_origins_old RENAME TO deployment_origins;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX uq_deployment_origins_seq
    ON deployment_origins (project_id, origin, seq);
-- +goose StatementEnd
