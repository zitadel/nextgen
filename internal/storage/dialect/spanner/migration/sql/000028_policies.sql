-- +goose NO TRANSACTION
-- +goose Up
-- +goose StatementBegin
CREATE TABLE policies (
    project_id  STRING(MAX) NOT NULL,
    id          STRING(MAX) NOT NULL,
    operation   STRING(MAX) NOT NULL,
    definition  JSON        NOT NULL,
    created_at  TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    CONSTRAINT fk_policies_project
        FOREIGN KEY (project_id)
        REFERENCES projects (id)
        ON DELETE CASCADE
) PRIMARY KEY (project_id, id)
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_policies_project_operation_created_at
    ON policies (project_id, operation, created_at DESC, id DESC)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_policies_project_operation_created_at
-- +goose StatementEnd

-- +goose StatementBegin
DROP TABLE IF EXISTS policies
-- +goose StatementEnd
