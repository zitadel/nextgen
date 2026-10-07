-- +goose Up
-- Deployments key on an origin string rather than on an environment row, and
-- the newest row per origin is what that target serves. Nothing points at a
-- deployment, so the environments table and its pointer column go.
DROP TABLE IF EXISTS zitadel_nextgen.deployments;
DROP TABLE IF EXISTS zitadel_nextgen.variables;
DROP TABLE IF EXISTS zitadel_nextgen.environments;

-- The project's origins: patterns with a kind. A primary pattern admits
-- requests; a preview pattern only bounds what a preview deploy may register.
-- The mode decides which patterns the project accepts.
ALTER TABLE zitadel_nextgen.projects DROP COLUMN IF EXISTS preview_origins;
ALTER TABLE zitadel_nextgen.projects ADD COLUMN origins JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(origins) = 'array');
ALTER TABLE zitadel_nextgen.projects ADD COLUMN mode TEXT COLLATE "C" NOT NULL DEFAULT 'sandbox'
    CHECK (mode IN ('sandbox', 'production'));

-- The operator's hard stop: a revoked release is refused on every path.
ALTER TABLE zitadel_nextgen.releases ADD COLUMN revoked_at TIMESTAMPTZ;

-- One row per live preview URL. The row is what admits a request from the
-- URL; a primary hostname has no row, since the pattern admits it and the
-- deployment history already says what it serves.
CREATE TABLE zitadel_nextgen.previews (
    project_id TEXT COLLATE "C" NOT NULL
        REFERENCES zitadel_nextgen.projects (id) ON DELETE CASCADE
    , origin TEXT COLLATE "C" NOT NULL CHECK (origin <> '')
    , expires_at TIMESTAMPTZ NOT NULL
    , created_at TIMESTAMPTZ NOT NULL DEFAULT now()

    , PRIMARY KEY (project_id, origin)
);

CREATE INDEX idx_previews_expires_at ON zitadel_nextgen.previews (expires_at);

-- A deployment is one operation: one release made live on a set of targets
-- at one instant. Append-only: deploy and rollback both insert, nothing
-- updates.
CREATE TABLE zitadel_nextgen.deployments (
    project_id TEXT COLLATE "C" NOT NULL
        REFERENCES zitadel_nextgen.projects (id) ON DELETE CASCADE
    , id TEXT COLLATE "C" NOT NULL CHECK (id <> '')
    , release_id TEXT COLLATE "C" NOT NULL
    , metadata JSONB NOT NULL
        CHECK (jsonb_typeof(metadata) = 'object')
    -- clock_timestamp() rather than now(): now() is fixed at transaction
    -- start, and the deploy's transaction can begin before it waits on the
    -- project row lock.
    , deployed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()

    , PRIMARY KEY (project_id, id)
    -- NO ACTION rather than CASCADE: a release named by any deployment must
    -- not be collected, so the newest row for a target can never name a
    -- release that has gone. NO ACTION is checked at the end of the whole
    -- statement, so a project delete that removes both still passes.
    , FOREIGN KEY (project_id, release_id)
        REFERENCES zitadel_nextgen.releases (project_id, id) ON DELETE NO ACTION
);

-- The unfiltered project-wide audit list.
CREATE INDEX idx_deployments_project_deployed_at
    ON zitadel_nextgen.deployments (project_id, deployed_at DESC, id DESC);

-- One row per target a deployment made its release live on. origin is a
-- plain string with no foreign key, so a retired preview keeps its history;
-- '' is the project default. release_id and deployed_at are the operation's,
-- copied so a target's history is one seek on this table.
CREATE TABLE zitadel_nextgen.deployment_targets (
    project_id TEXT COLLATE "C" NOT NULL
    , deployment_id TEXT COLLATE "C" NOT NULL
    , origin TEXT COLLATE "C" NOT NULL DEFAULT ''
    , release_id TEXT COLLATE "C" NOT NULL
    , deployed_at TIMESTAMPTZ NOT NULL

    , PRIMARY KEY (project_id, deployment_id, origin)
    , FOREIGN KEY (project_id, deployment_id)
        REFERENCES zitadel_nextgen.deployments (project_id, id) ON DELETE CASCADE
);

-- A target's history lists newest-first; the deployment id breaks
-- deployed_at ties. The first row under this order is what the target serves.
CREATE INDEX idx_deployment_targets_project_origin_deployed_at
    ON zitadel_nextgen.deployment_targets (project_id, origin, deployed_at DESC, deployment_id DESC);

-- One row per variable value. applies_to says whether the value is for every
-- deploy or the override a preview deploy prefers; two rows per name is the
-- maximum.
CREATE TABLE zitadel_nextgen.variables (
    project_id TEXT NOT NULL CHECK (project_id <> '')
        REFERENCES zitadel_nextgen.projects (id) ON DELETE CASCADE
    , name TEXT NOT NULL CHECK (name <> '')
    , applies_to TEXT COLLATE "C" NOT NULL DEFAULT 'all'
        CHECK (applies_to IN ('all', 'preview'))
    , value JSONB NOT NULL
    , is_secret BOOLEAN NOT NULL DEFAULT FALSE
    , created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    , modified_at TIMESTAMPTZ NOT NULL DEFAULT NOW()

    , PRIMARY KEY (project_id, name, applies_to)
);

-- The values one deployment runs, frozen when the row was written and never
-- updated. Same columns as the store, so a secret is copied as the
-- ciphertext it already is.
CREATE TABLE zitadel_nextgen.deployment_variables (
    project_id TEXT COLLATE "C" NOT NULL
    , deployment_id TEXT COLLATE "C" NOT NULL
    , name TEXT NOT NULL CHECK (name <> '')
    , value JSONB NOT NULL
    , is_secret BOOLEAN NOT NULL DEFAULT FALSE

    , PRIMARY KEY (project_id, deployment_id, name)
    , FOREIGN KEY (project_id, deployment_id)
        REFERENCES zitadel_nextgen.deployments (project_id, id) ON DELETE CASCADE
);

-- +goose Down
DROP TABLE IF EXISTS zitadel_nextgen.deployment_variables;
DROP TABLE IF EXISTS zitadel_nextgen.variables;
DROP INDEX IF EXISTS zitadel_nextgen.idx_deployment_targets_project_origin_deployed_at;
DROP TABLE IF EXISTS zitadel_nextgen.deployment_targets;
DROP INDEX IF EXISTS zitadel_nextgen.idx_deployments_project_deployed_at;
DROP TABLE IF EXISTS zitadel_nextgen.deployments;
DROP INDEX IF EXISTS zitadel_nextgen.idx_previews_expires_at;
DROP TABLE IF EXISTS zitadel_nextgen.previews;
ALTER TABLE zitadel_nextgen.releases DROP COLUMN IF EXISTS revoked_at;
ALTER TABLE zitadel_nextgen.projects DROP COLUMN IF EXISTS mode;
ALTER TABLE zitadel_nextgen.projects DROP COLUMN IF EXISTS origins;
ALTER TABLE zitadel_nextgen.projects ADD COLUMN preview_origins TEXT[] NOT NULL DEFAULT '{}';
