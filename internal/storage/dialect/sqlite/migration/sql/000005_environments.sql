-- +goose Up
-- +goose StatementBegin
-- An environment is a runtime slot on a project (ADR 035). Identity only:
-- the release an environment runs arrives with deployments (#532).
CREATE TABLE environments (
    project_id  TEXT    NOT NULL,
    id          TEXT    NOT NULL,
    name        TEXT    NOT NULL,
    created_at  INTEGER NOT NULL,
    PRIMARY KEY (project_id, id),
    CONSTRAINT chk_environments_name CHECK (name <> '' AND length(name) <= 63),
    CONSTRAINT fk_environments_project
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);
-- +goose StatementEnd

-- +goose StatementBegin
-- Environment names are unique per project and address the resource on the
-- wire (GET /environments/{name}). No lowered companion column: the domain
-- validator restricts names to a lowercase DNS-style label, so there is no
-- second casing that could collide.
CREATE UNIQUE INDEX uq_environments_project_name ON environments (project_id, name);
-- +goose StatementEnd

-- +goose StatementBegin
-- Serves the pipeline-ordered list (created_at ASC, id ASC).
CREATE INDEX idx_environments_project_created_at ON environments (project_id, created_at, id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_environments_project_created_at;
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS uq_environments_project_name;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS environments;
-- +goose StatementEnd
