CREATE SCHEMA IF NOT EXISTS zitadel_nextgen;

CREATE TABLE zitadel_nextgen.flow_definitions (
    project_id      TEXT NOT NULL
    , id            TEXT NOT NULL
    , name          TEXT NOT NULL
    , engine_version TEXT NOT NULL
    , schema_version TEXT NOT NULL
    , status        TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'active', 'deprecated', 'archived'))
    , purposes      TEXT[] NOT NULL DEFAULT '{}'
    , definition    JSONB NOT NULL
    , created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    , updated_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    , PRIMARY KEY (project_id, id)
);

CREATE INDEX idx_flow_definitions_project_status
    ON zitadel_nextgen.flow_definitions (project_id, status);
