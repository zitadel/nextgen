-- +goose NO TRANSACTION
-- +goose Up
-- +goose StatementBegin
-- The deployed release decides which flow revisions are served; see the
-- postgres migration.
DROP INDEX idx_flow_definitions_project_status
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE flow_definitions DROP COLUMN status
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
ALTER TABLE flow_definitions ADD COLUMN status STRING(MAX) NOT NULL DEFAULT ('draft')
-- +goose StatementEnd
-- +goose StatementBegin
UPDATE flow_definitions SET status = 'active' WHERE TRUE
-- +goose StatementEnd
-- +goose StatementBegin
CREATE INDEX idx_flow_definitions_project_status
    ON flow_definitions (project_id, status)
-- +goose StatementEnd
