-- +goose NO TRANSACTION
-- +goose Up
-- +goose StatementBegin
CREATE TABLE teams (
    project_id  STRING(MAX) NOT NULL,
    id          STRING(MAX) NOT NULL,
    name        STRING(MAX) NOT NULL,
    created_at  TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    updated_at  TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    CONSTRAINT fk_teams_project
        FOREIGN KEY (project_id)
        REFERENCES projects (id)
        ON DELETE CASCADE,
) PRIMARY KEY (project_id, id)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
DROP TABLE IF EXISTS teams
-- +goose StatementEnd
