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
)

CREATE TABLE zitadel_nextgen.flow_definitions (
    instance_id         TEXT NOT NULL
    , id                TEXT NOT NULL CHECK (id <> '')
    , name              TEXT NOT NULL CHECK (name <> '')
    , engine_version    TEXT NOT NULL CHECK (engine_version <> '')
    , schema_version    TEXT NOT NULL CHECK (schema_version <> '')
    , status            zitadel_nextgen.flow_definition_states NOT NULL DEFAULT 'draft'::zitadel_nextgen.flow_definition_states
    , purpose           zitadel_nextgen.flow_definition_purposes NOT NULL
    , definition        JSONB NOT NULL
    , created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    , updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()

    , PRIMARY KEY (instance_id, id)
);

CREATE INDEX idx_flow_definitions_instance_status
    ON zitadel_nextgen.flow_definitions (instance_id, status);

CREATE INDEX idx_flow_definitions_instance_purpose
    ON zitadel_nextgen.flow_definitions (instance_id, purpose);