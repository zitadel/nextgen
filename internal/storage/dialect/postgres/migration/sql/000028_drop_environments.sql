-- +goose Up
-- The environment is no longer a resource, and a project's variables are owned
-- by the project alone. CASCADE takes the references with the table and the
-- column: the deployments foreign key, and on variables the generated
-- environment_ref, its foreign key and the primary key. Deployments keep their
-- environment_id until they are reworked over targets.
DROP TABLE zitadel_nextgen.environments CASCADE;

ALTER TABLE zitadel_nextgen.variables DROP COLUMN environment_id CASCADE;

ALTER TABLE zitadel_nextgen.variables ADD PRIMARY KEY (name, project_id);

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
