-- +goose Up
-- The deployed release decides which flow revisions are served, so a revision
-- carries no status of its own.
DROP INDEX IF EXISTS zitadel_nextgen.idx_flow_definitions_project_status;
ALTER TABLE zitadel_nextgen.flow_definitions DROP COLUMN status;
DROP TYPE IF EXISTS zitadel_nextgen.flow_definition_states;

-- +goose Down
CREATE TYPE zitadel_nextgen.flow_definition_states AS ENUM (
    'draft'
    , 'active'
    , 'deprecated'
    , 'archived'
);
ALTER TABLE zitadel_nextgen.flow_definitions
    ADD COLUMN status zitadel_nextgen.flow_definition_states NOT NULL
        DEFAULT 'draft'::zitadel_nextgen.flow_definition_states;
UPDATE zitadel_nextgen.flow_definitions SET status = 'active';
CREATE INDEX idx_flow_definitions_project_status
    ON zitadel_nextgen.flow_definitions (project_id, status);
