-- +goose NO TRANSACTION
-- +goose Up
CREATE SCHEMA IF NOT EXISTS zitadel_nextgen;

CREATE TABLE zitadel_nextgen.flow_definitions (
    project_id      STRING(MAX) NOT NULL,
    id              STRING(MAX) NOT NULL CHECK (id != ''),
    name            STRING(MAX) NOT NULL CHECK (name != ''),
    schema_version  STRING(MAX) NOT NULL CHECK (schema_version != ''),
    status          STRING(MAX) NOT NULL DEFAULT ('draft'),
    purposes        ARRAY<STRING(MAX)>,
    definition      JSON        NOT NULL,
    created_at      TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    updated_at      TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
) PRIMARY KEY (project_id, id);

CREATE INDEX idx_flow_definitions_project_status
    ON zitadel_nextgen.flow_definitions (project_id, status);

-- +goose Down
-- +goose NO TRANSACTION
DROP INDEX IF EXISTS zitadel_nextgen.idx_flow_definitions_project_status;
DROP TABLE IF EXISTS zitadel_nextgen.flow_definitions;
DROP SCHEMA IF EXISTS zitadel_nextgen;
