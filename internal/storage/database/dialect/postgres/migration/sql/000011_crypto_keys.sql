-- +goose Up
CREATE TABLE zitadel_nextgen.deks
(
    project_id   TEXT COLLATE "C" NOT NULL
        REFERENCES zitadel_nextgen.projects (id)
            ON DELETE CASCADE,
    id           TEXT COLLATE "C" NOT NULL CHECK (id <> ''),
    key          BYTEA            NOT NULL,
    algorithm    TEXT             NOT NULL CHECK (algorithm <> ''),
    state        TEXT             NOT NULL CHECK (state <> ''),
    created_at   TIMESTAMPTZ      NOT NULL DEFAULT now(),
    activated_at TIMESTAMPTZ NULL,
    retired_at   TIMESTAMPTZ NULL,
    purpose      TEXT             NOT NULL CHECK (purpose <> ''),
    PRIMARY KEY (project_id, id)
);

-- A project has at most one active DEK. This partial unique index enforces that
-- invariant and backs the GetActiveDEK lookup (project_id + state = 'active').
CREATE UNIQUE INDEX uq_deks_active_per_project
    ON zitadel_nextgen.deks (project_id) WHERE state = 'active' AND purpose = 'dek';

-- +goose Down
DROP INDEX IF EXISTS zitadel_nextgen.uq_deks_active_per_project;
DROP TABLE IF EXISTS zitadel_nextgen.deks;
