-- +goose Up
-- Deployments go to origins instead of environments. What an origin serves is
-- its newest row in deployment_origins; nothing stored is kept, and the
-- dropped deployments' resource-scope rows go with them.
DELETE FROM zitadel_nextgen.resource_scope_index WHERE resource_kind = 'deployment';
DROP TABLE zitadel_nextgen.deployments;

CREATE TABLE zitadel_nextgen.deployments (
    project_id TEXT COLLATE "C" NOT NULL
        REFERENCES zitadel_nextgen.projects (id) ON DELETE CASCADE
    , id TEXT COLLATE "C" NOT NULL CHECK (id <> '')
    , release_id TEXT COLLATE "C" NOT NULL
    , origin_kind TEXT COLLATE "C" NOT NULL CHECK (origin_kind IN ('primary', 'preview'))
    , metadata JSONB NOT NULL CHECK (jsonb_typeof(metadata) = 'object')
    , deployed_at TIMESTAMPTZ NOT NULL

    , PRIMARY KEY (project_id, id)
    -- NO ACTION: a deployed release is never deleted, but a project delete
    -- still cascades through both tables.
    , FOREIGN KEY (project_id, release_id)
        REFERENCES zitadel_nextgen.releases (project_id, id)
);

CREATE INDEX idx_deployments_project_deployed_at
    ON zitadel_nextgen.deployments (project_id, deployed_at DESC, id DESC);

-- release_id, origin_kind and deployed_at are copied so origin queries read
-- this table alone. origin is not a reference, so history outlives it.
CREATE TABLE zitadel_nextgen.deployment_origins (
    project_id TEXT COLLATE "C" NOT NULL
    , deployment_id TEXT COLLATE "C" NOT NULL
    , origin TEXT COLLATE "C" NOT NULL CHECK (origin <> '')
    , release_id TEXT COLLATE "C" NOT NULL
    , origin_kind TEXT COLLATE "C" NOT NULL CHECK (origin_kind IN ('primary', 'preview'))
    , deployed_at TIMESTAMPTZ NOT NULL
    -- Counts the deployments to the origin; the newest has the highest.
    , seq BIGINT NOT NULL CHECK (seq > 0)

    , PRIMARY KEY (project_id, deployment_id, origin)
    , FOREIGN KEY (project_id, deployment_id)
        REFERENCES zitadel_nextgen.deployments (project_id, id) ON DELETE CASCADE
);

-- The optimistic lock: two deploys that read the same newest row both write
-- seq + 1, and this index rejects the second.
CREATE UNIQUE INDEX uq_deployment_origins_seq
    ON zitadel_nextgen.deployment_origins (project_id, origin, seq);

-- One row per preview URL; primary origins have none.
CREATE TABLE zitadel_nextgen.previews (
    project_id TEXT COLLATE "C" NOT NULL
        REFERENCES zitadel_nextgen.projects (id) ON DELETE CASCADE
    , origin TEXT COLLATE "C" NOT NULL CHECK (origin <> '')
    , expires_at TIMESTAMPTZ NOT NULL
    , created_at TIMESTAMPTZ NOT NULL

    , PRIMARY KEY (project_id, origin)
);

CREATE INDEX idx_previews_project_created_at
    ON zitadel_nextgen.previews (project_id, created_at DESC, origin DESC);
CREATE INDEX idx_previews_project_expires_at
    ON zitadel_nextgen.previews (project_id, expires_at, origin);

-- +goose Down
DROP TABLE IF EXISTS zitadel_nextgen.previews;
DROP TABLE IF EXISTS zitadel_nextgen.deployment_origins;
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
