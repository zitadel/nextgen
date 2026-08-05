-- +goose Up
CREATE TYPE zitadel_nextgen.flow_definition_states AS ENUM (
    'draft'
    , 'active'
    , 'deprecated'
    , 'archived'
);

CREATE TYPE zitadel_nextgen.flow_definition_purposes AS ENUM (
    'login'
    , 'register'
    , 'recovery'
    , 'profiling'
    , 'reauth'
    , 'link_account'
);

CREATE TABLE zitadel_nextgen.flow_definitions (
    project_id          TEXT NOT NULL
    , id                TEXT NOT NULL CHECK (id <> '')
    , name              TEXT NOT NULL CHECK (name <> '')
    , schema_version    TEXT NOT NULL CHECK (schema_version <> '')
    , status            zitadel_nextgen.flow_definition_states NOT NULL DEFAULT 'draft'::zitadel_nextgen.flow_definition_states
    , purposes          zitadel_nextgen.flow_definition_purposes[] NOT NULL
    , definition        JSONB NOT NULL
    , created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    , updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()

    , PRIMARY KEY (project_id, id)
    , CONSTRAINT fk_flow_definitions_project
        FOREIGN KEY (project_id) REFERENCES zitadel_nextgen.projects (id)
        ON DELETE CASCADE
);

CREATE INDEX idx_flow_definitions_project_status
    ON zitadel_nextgen.flow_definitions (project_id, status);

CREATE INDEX idx_flow_definitions_project_purposes
    ON zitadel_nextgen.flow_definitions USING GIN (purposes);

-- +goose Down
DROP INDEX IF EXISTS zitadel_nextgen.idx_flow_definitions_project_purposes;
DROP INDEX IF EXISTS zitadel_nextgen.idx_flow_definitions_project_status;
DROP TABLE IF EXISTS zitadel_nextgen.flow_definitions;
DROP TYPE IF EXISTS zitadel_nextgen.flow_definition_purposes;
DROP TYPE IF EXISTS zitadel_nextgen.flow_definition_states;
