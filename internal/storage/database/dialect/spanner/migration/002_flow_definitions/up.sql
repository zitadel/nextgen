CREATE SCHEMA IF NOT EXISTS zitadel_nextgen;

CREATE TABLE zitadel_nextgen.flow_definitions (
    project_id      TEXT NOT NULL
    , id            TEXT NOT NULL
    , name          TEXT NOT NULL
    , engine_version TEXT NOT NULL
    , schema_version TEXT NOT NULL
    , status        TEXT NOT NULL DEFAULT 'draft'
    , purposes      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[]
    , definition    JSONB NOT NULL
    , created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    , updated_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    , PRIMARY KEY (project_id, id)
);

CREATE INDEX idx_flow_definitions_project_status
    ON zitadel_nextgen.flow_definitions (project_id, status);

-- Spanner PostgreSQL dialect does not support GIN indexes (USING GIN is not valid DDL syntax).
-- The purposes[] array filter (= ANY(purposes)) uses a sequential scan within the project_id
-- partition, which is acceptable given each project has at most a few dozen flow definitions.
