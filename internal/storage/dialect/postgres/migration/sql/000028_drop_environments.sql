-- +goose Up
-- The environment is no longer a resource: a project's variables are owned by
-- the project alone, and the environments table goes. Variables scoped to an
-- environment have no owner left, so they go with it.
DELETE FROM zitadel_nextgen.variables WHERE environment_id <> '';

ALTER TABLE zitadel_nextgen.variables
    DROP CONSTRAINT fk_variables_environment,
    DROP CONSTRAINT variables_pkey,
    DROP COLUMN environment_ref,
    DROP COLUMN environment_id,
    ADD PRIMARY KEY (name, project_id);

-- Deployments keep their environment_id until they are reworked over targets;
-- only the reference to the dropped table goes.
ALTER TABLE zitadel_nextgen.deployments
    DROP CONSTRAINT deployments_project_id_environment_id_fkey;

DROP TABLE zitadel_nextgen.environments;

-- +goose Down
CREATE TABLE zitadel_nextgen.environments (
    project_id TEXT COLLATE "C" NOT NULL
        REFERENCES zitadel_nextgen.projects (id) ON DELETE CASCADE
    , id TEXT COLLATE "C" NOT NULL CHECK (id <> '')
    , name TEXT COLLATE "C" NOT NULL CHECK (name <> '' AND length(name) <= 63)
    , created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    , current_deployment_id TEXT COLLATE "C"

    , PRIMARY KEY (project_id, id)
);

CREATE UNIQUE INDEX uq_environments_project_name
    ON zitadel_nextgen.environments (project_id, name);

-- No environment survives the round trip, so neither does a deployment to one.
DELETE FROM zitadel_nextgen.deployments;

ALTER TABLE zitadel_nextgen.deployments
    ADD CONSTRAINT deployments_project_id_environment_id_fkey
        FOREIGN KEY (project_id, environment_id)
        REFERENCES zitadel_nextgen.environments (project_id, id) ON DELETE CASCADE;

ALTER TABLE zitadel_nextgen.variables
    DROP CONSTRAINT variables_pkey,
    ADD COLUMN environment_id TEXT NOT NULL DEFAULT '',
    ADD COLUMN environment_ref TEXT GENERATED ALWAYS AS (NULLIF(environment_id, '')) STORED,
    ADD PRIMARY KEY (name, project_id, environment_id),
    ADD CONSTRAINT fk_variables_environment
        FOREIGN KEY (project_id, environment_ref)
        REFERENCES zitadel_nextgen.environments (project_id, id)
        ON DELETE CASCADE;
