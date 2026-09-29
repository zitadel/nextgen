-- +goose Up
-- +goose StatementBegin
-- One row per policy revision (ADR 066). See the postgres migration.
CREATE TABLE policies (
    project_id  TEXT    NOT NULL,
    id          TEXT    NOT NULL CHECK (id <> ''),
    operation   TEXT    NOT NULL CHECK (operation <> ''),
    definition  TEXT    NOT NULL,
    created_at  INTEGER NOT NULL,
    PRIMARY KEY (project_id, id),
    CONSTRAINT fk_policies_project
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_policies_project_operation_created_at
    ON policies (project_id, operation, created_at DESC, id DESC);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_policies_project_operation_created_at;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS policies;
-- +goose StatementEnd
