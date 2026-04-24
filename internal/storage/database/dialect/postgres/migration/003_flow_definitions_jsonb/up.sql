CREATE TABLE zitadel_nextgen.flow_definitions_jsonb (
    instance_id     TEXT NOT NULL
    , id            TEXT NOT NULL CHECK (id <> '')
    , name          TEXT NOT NULL CHECK (name <> '')
    , engine_version TEXT NOT NULL CHECK (engine_version <> '')
    , schema_version TEXT NOT NULL CHECK (schema_version <> '')
    , status        TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'active', 'deprecated', 'archived'))
    , definition    JSONB NOT NULL
    , created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    , updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()

    , PRIMARY KEY (instance_id, id)
);

CREATE INDEX idx_flow_definitions_jsonb_instance_status
    ON zitadel_nextgen.flow_definitions_jsonb (instance_id, status);
