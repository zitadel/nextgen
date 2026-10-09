-- +goose NO TRANSACTION
-- +goose Up
-- +goose StatementBegin
CREATE TABLE flow_definitions (
    project_id      STRING(MAX) NOT NULL,
    id              STRING(MAX) NOT NULL,
    name            STRING(MAX) NOT NULL,
    schema_version  STRING(MAX) NOT NULL,
    status          STRING(MAX) NOT NULL DEFAULT ('draft'),
    purposes        ARRAY<STRING(MAX)> NOT NULL,
    definition      JSON        NOT NULL,
    created_at      TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    updated_at      TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    CONSTRAINT fk_flow_definitions_project
        FOREIGN KEY (project_id)
        REFERENCES projects (id)
        ON DELETE CASCADE,
) PRIMARY KEY (project_id, id)
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_flow_definitions_project_status
    ON flow_definitions (project_id, status)
-- +goose StatementEnd

-- Revisions of one flow share its name and are ordered by created_at, so at
-- most one may carry a given timestamp: a collision has no determinate winner
-- and must fail loudly instead. The index is also the seek the latest-revision
-- anti-join in ListFlowDefinitions uses. name is NOT NULL, so no NULL_FILTERED
-- is needed here.
-- +goose StatementBegin
CREATE UNIQUE INDEX idx_flow_definitions_name_revision
    ON flow_definitions (project_id, name, created_at)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_flow_definitions_name_revision
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_flow_definitions_project_status
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS flow_definitions
-- +goose StatementEnd
