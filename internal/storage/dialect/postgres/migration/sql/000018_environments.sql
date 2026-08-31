-- +goose Up
-- An environment is a runtime slot on a project (ADR 035). Identity only:
-- the release an environment runs arrives with deployments (#532).
CREATE TABLE zitadel_nextgen.environments (
    project_id TEXT COLLATE "C" NOT NULL
        REFERENCES zitadel_nextgen.projects (id) ON DELETE CASCADE
    , id TEXT COLLATE "C" NOT NULL CHECK (id <> '')
    , name TEXT COLLATE "C" NOT NULL CHECK (name <> '' AND length(name) <= 63)
    , created_at TIMESTAMPTZ NOT NULL DEFAULT now()

    , PRIMARY KEY (project_id, id)
);

-- Environment names are unique per project and address the resource on the
-- wire (GET /environments/{name}). No lowered companion column: the domain
-- validator restricts names to a lowercase DNS-style label, so there is no
-- second casing that could collide.
CREATE UNIQUE INDEX uq_environments_project_name
    ON zitadel_nextgen.environments (project_id, name);

-- Serves the pipeline-ordered list (created_at ASC, id ASC).
CREATE INDEX idx_environments_project_created_at
    ON zitadel_nextgen.environments (project_id, created_at, id);

-- +goose Down
DROP INDEX IF EXISTS zitadel_nextgen.idx_environments_project_created_at;
DROP INDEX IF EXISTS zitadel_nextgen.uq_environments_project_name;
DROP TABLE IF EXISTS zitadel_nextgen.environments;
