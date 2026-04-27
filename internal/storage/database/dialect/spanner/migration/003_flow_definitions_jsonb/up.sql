CREATE TABLE zitadel_nextgen.flow_definitions_jsonb (
    instance_id         STRING(MAX) NOT NULL
    , id                STRING(MAX) NOT NULL
    , name              STRING(MAX) NOT NULL
    , engine_version    STRING(MAX) NOT NULL
    , schema_version    STRING(MAX) NOT NULL
    -- Spanner has no support for enums, so we need to have checks in place instead
    , status            STRING(MAX) NOT NULL DEFAULT ('draft') CHECK (status IN ('draft', 'active', 'deprecated', 'archived'))
    , purpose           STRING(MAX) NOT NULL CHECK (purpose IN ('login', 'register', 'recovery', 'profiling', 'reauth', 'link_account'))
    , definition        JSON NOT NULL
    , created_at        TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP())
    , updated_at        TIMESTAMP NOT NULL DEFAULT (CURRENT_TIMESTAMP())

    , PRIMARY KEY (instance_id, id);

CREATE INDEX idx_flow_definitions_jsonb_instance_status
    ON zitadel_nextgen.flow_definitions_jsonb (instance_id, status);

CREATE INDEX idx_flow_definitions_instance_purpose
    ON zitadel_nextgen.flow_definitions (instance_id, purpose);