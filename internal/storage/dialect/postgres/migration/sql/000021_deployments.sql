-- +goose Up
-- A deployment is an immutable, project-scoped record of a release being made
-- live on an environment (ADR 035, #532). Rows are append-only: deploy,
-- promote and rollback all insert one, and nothing updates or deletes them
-- short of the environment or project going away.
CREATE TABLE zitadel_nextgen.deployments (
    project_id TEXT COLLATE "C" NOT NULL
    , id TEXT COLLATE "C" NOT NULL CHECK (id <> '')
    , environment_id TEXT COLLATE "C" NOT NULL
    , release_id TEXT COLLATE "C" NOT NULL
    -- Why the release went live and who made it happen (reason,
    -- source_environment_id, deployed_by, deployed_by_type). A document
    -- rather than columns because nothing filters or orders on it: it is
    -- written once and handed back verbatim, so a new field costs no
    -- migration on three dialects. The promotion source inside it is an
    -- audit value with no foreign key semantics -- it keeps naming the
    -- environment even after that environment is deleted. Anything that
    -- needs filtering or ordering earns a column instead, which is why
    -- deployed_at is one.
    , metadata JSONB NOT NULL
        CHECK (jsonb_typeof(metadata) = 'object')
    , deployed_at TIMESTAMPTZ NOT NULL DEFAULT now()

    , PRIMARY KEY (project_id, id)
    -- Deleting an environment deletes its deployment log: the rows answer
    -- "what runs where", and a deleted environment runs nothing. The audit
    -- trail survives in the events table, which has no such reference.
    , FOREIGN KEY (project_id, environment_id)
        REFERENCES zitadel_nextgen.environments (project_id, id) ON DELETE CASCADE
    -- CASCADE rather than NO ACTION, though a release row only ever dies via
    -- the project cascade: SQLite enforces foreign keys immediately while
    -- cascading, so a NO ACTION reference could abort a project delete
    -- depending on which child table the cascade reaches first.
    , FOREIGN KEY (project_id, release_id)
        REFERENCES zitadel_nextgen.releases (project_id, id) ON DELETE CASCADE
);

-- An environment's history lists newest-first by keyset; id breaks
-- deployed_at ties. The first row under this order is the environment's
-- current deployment.
CREATE INDEX idx_deployments_project_env_deployed_at
    ON zitadel_nextgen.deployments (project_id, environment_id, deployed_at DESC, id DESC);

-- The unfiltered project-wide audit list, same order without the environment.
CREATE INDEX idx_deployments_project_deployed_at
    ON zitadel_nextgen.deployments (project_id, deployed_at DESC, id DESC);

-- The deployment an environment currently runs, swapped inside the same
-- transaction that inserts the deployment row. Denormalized so env reads are
-- one row and the optimistic-concurrency check is one compare. No foreign
-- key: it would be circular with the environment cascade above, and the
-- column is only ever written next to the row it points at.
ALTER TABLE zitadel_nextgen.environments ADD COLUMN current_deployment_id TEXT COLLATE "C";

-- +goose Down
ALTER TABLE zitadel_nextgen.environments DROP COLUMN IF EXISTS current_deployment_id;
DROP INDEX IF EXISTS zitadel_nextgen.idx_deployments_project_deployed_at;
DROP INDEX IF EXISTS zitadel_nextgen.idx_deployments_project_env_deployed_at;
DROP TABLE IF EXISTS zitadel_nextgen.deployments;
