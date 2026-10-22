-- +goose NO TRANSACTION
-- +goose Up
-- +goose StatementBegin
-- An environment is a runtime slot on a project (ADR 035). Identity only:
-- the release an environment runs arrives with deployments (#532).
CREATE TABLE environments (
    project_id  STRING(MAX) NOT NULL,
    id          STRING(MAX) NOT NULL,
    name        STRING(63)  NOT NULL,
    created_at  TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    CONSTRAINT chk_environments_name CHECK (name <> ''),
    CONSTRAINT fk_environments_project
        FOREIGN KEY (project_id)
        REFERENCES projects (id)
        ON DELETE CASCADE,
) PRIMARY KEY (project_id, id)
-- +goose StatementEnd
-- +goose StatementBegin
-- Environment names are unique per project, address the resource on the wire
-- (GET /environments/{name}), and order the list -- name is the only portable
-- total order across the three dialects. No lowered companion column: the domain
-- validator restricts names to a lowercase DNS-style label, so there is no
-- second casing that could collide.
CREATE UNIQUE INDEX uq_environments_project_name
    ON environments (project_id, name)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
DROP INDEX IF EXISTS uq_environments_project_name
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS environments
-- +goose StatementEnd
