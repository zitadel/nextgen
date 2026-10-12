-- +goose Up
-- The environment is no longer a resource, and a project's variables are owned
-- by the project alone. Nothing stored is kept: variables is recreated rather
-- than altered, and CASCADE takes the deployments reference with environments.
-- Deployments keep their environment_id until they are reworked over targets.
DROP TABLE zitadel_nextgen.variables;

DROP TABLE zitadel_nextgen.environments CASCADE;

CREATE TABLE zitadel_nextgen.variables (
    name             TEXT NOT NULL CHECK (name <> '')
    , project_id     TEXT NOT NULL CHECK (project_id <> '')
        REFERENCES zitadel_nextgen.projects (id) ON DELETE CASCADE
    , value          JSONB NOT NULL
    , is_secret      BOOLEAN NOT NULL DEFAULT FALSE
    , created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    , modified_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()

    , PRIMARY KEY (name, project_id)
);

CREATE INDEX idx_variables_project_name
    ON zitadel_nextgen.variables (project_id, name);

-- +goose Down
DROP TABLE zitadel_nextgen.variables;

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

CREATE TABLE zitadel_nextgen.variables (
    name             TEXT NOT NULL CHECK (name <> '')
    , project_id     TEXT NOT NULL CHECK (project_id <> '')
        REFERENCES zitadel_nextgen.projects (id) ON DELETE CASCADE
    , environment_id  TEXT NOT NULL DEFAULT ''
    , environment_ref TEXT GENERATED ALWAYS AS (NULLIF(environment_id, '')) STORED
    , value          JSONB NOT NULL
    , is_secret      BOOLEAN NOT NULL DEFAULT FALSE
    , created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    , modified_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()

    , PRIMARY KEY (name, project_id, environment_id)
    , CONSTRAINT fk_variables_environment
        FOREIGN KEY (project_id, environment_ref)
        REFERENCES zitadel_nextgen.environments (project_id, id)
        ON DELETE CASCADE
);

CREATE INDEX idx_variables_project_name
    ON zitadel_nextgen.variables (project_id, name);
