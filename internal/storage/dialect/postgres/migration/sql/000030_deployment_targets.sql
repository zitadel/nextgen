-- +goose Up
-- A deployment is one operation over a set of targets, each an origin, and
-- what a target serves is the newest deployment that names it. Nothing points
-- at a deployment and nothing updates one: deploy, rollback and preview expiry
-- are all appends or deletes elsewhere, so no pointer can disagree with the
-- history. Nothing stored is kept.
DROP TABLE zitadel_nextgen.deployments;

CREATE TABLE zitadel_nextgen.deployments (
    project_id TEXT COLLATE "C" NOT NULL
        REFERENCES zitadel_nextgen.projects (id) ON DELETE CASCADE
    , id TEXT COLLATE "C" NOT NULL CHECK (id <> '')
    -- NO ACTION rather than CASCADE: a release named by any deployment is
    -- never deleted. Not RESTRICT either, which would refuse a project delete
    -- whose cascade reaches the release before the deployment; NO ACTION is
    -- checked once the whole cascade has run.
    , release_id TEXT COLLATE "C" NOT NULL
    -- One deployment never mixes primary origins and preview URLs. The live
    -- view admits a preview target only while its preview stands.
    , target_kind TEXT COLLATE "C" NOT NULL CHECK (target_kind IN ('primary', 'preview'))
    -- Why the release went live and who made it happen. A document rather
    -- than columns because nothing queries it: it is written once and handed
    -- back verbatim. Anything that needs filtering or ordering earns a column
    -- instead, which is why deployed_at is one.
    , metadata JSONB NOT NULL CHECK (jsonb_typeof(metadata) = 'object')
    -- Stamped by the statement after it holds the project lock, and never
    -- earlier than the newest deployment it supersedes, so a later deploy is
    -- always the newer one.
    , deployed_at TIMESTAMPTZ NOT NULL

    , PRIMARY KEY (project_id, id)
    , FOREIGN KEY (project_id, release_id)
        REFERENCES zitadel_nextgen.releases (project_id, id)
);

-- The project's deployments list newest-first by keyset; id breaks
-- deployed_at ties.
CREATE INDEX idx_deployments_project_deployed_at
    ON zitadel_nextgen.deployments (project_id, deployed_at DESC, id DESC);

-- One row per origin a deployment named. release_id and deployed_at are
-- copies of the deployment's, so the newest-per-origin seek reads this table
-- alone. origin is a plain string, not a reference: an origin keeps its
-- history after the pattern or preview that admitted it is gone.
CREATE TABLE zitadel_nextgen.deployment_targets (
    project_id TEXT COLLATE "C" NOT NULL
    , deployment_id TEXT COLLATE "C" NOT NULL
    , origin TEXT COLLATE "C" NOT NULL CHECK (origin <> '')
    , release_id TEXT COLLATE "C" NOT NULL
    , deployed_at TIMESTAMPTZ NOT NULL

    , PRIMARY KEY (project_id, deployment_id, origin)
    , FOREIGN KEY (project_id, deployment_id)
        REFERENCES zitadel_nextgen.deployments (project_id, id) ON DELETE CASCADE
);

-- An origin's history newest-first, and its first row is what it serves. The
-- same order breaks ties as the deployments index does.
CREATE INDEX idx_deployment_targets_origin_newest
    ON zitadel_nextgen.deployment_targets (project_id, origin, deployed_at DESC, deployment_id DESC);

-- A preview admits one exact URL as a target until it expires. A deploy to
-- the URL creates or renews it; removal and the sweep delete it, leaving the
-- deployments to the URL in place. Primary origins have no row here.
CREATE TABLE zitadel_nextgen.previews (
    project_id TEXT COLLATE "C" NOT NULL
        REFERENCES zitadel_nextgen.projects (id) ON DELETE CASCADE
    , origin TEXT COLLATE "C" NOT NULL CHECK (origin <> '')
    , expires_at TIMESTAMPTZ NOT NULL
    -- The first deploy to the URL; a renewal keeps it.
    , created_at TIMESTAMPTZ NOT NULL

    , PRIMARY KEY (project_id, origin)
);

-- The live list newest-first, and the sweep's expired-first scan.
CREATE INDEX idx_previews_project_created_at
    ON zitadel_nextgen.previews (project_id, created_at DESC, origin DESC);
CREATE INDEX idx_previews_project_expires_at
    ON zitadel_nextgen.previews (project_id, expires_at, origin);

-- +goose Down
DROP TABLE IF EXISTS zitadel_nextgen.previews;
DROP TABLE IF EXISTS zitadel_nextgen.deployment_targets;
DROP TABLE IF EXISTS zitadel_nextgen.deployments;

CREATE TABLE zitadel_nextgen.deployments (
    project_id TEXT COLLATE "C" NOT NULL
    , id TEXT COLLATE "C" NOT NULL CHECK (id <> '')
    , environment_id TEXT COLLATE "C" NOT NULL
    , release_id TEXT COLLATE "C" NOT NULL
    , metadata JSONB NOT NULL CHECK (jsonb_typeof(metadata) = 'object')
    , deployed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()

    , PRIMARY KEY (project_id, id)
    , FOREIGN KEY (project_id, release_id)
        REFERENCES zitadel_nextgen.releases (project_id, id) ON DELETE CASCADE
);

CREATE INDEX idx_deployments_project_env_deployed_at
    ON zitadel_nextgen.deployments (project_id, environment_id, deployed_at DESC, id DESC);

CREATE INDEX idx_deployments_project_deployed_at
    ON zitadel_nextgen.deployments (project_id, deployed_at DESC, id DESC);
