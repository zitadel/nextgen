-- +goose NO TRANSACTION
-- +goose Up
-- +goose StatementBegin
CREATE TABLE projects (
    id              STRING(MAX) NOT NULL,
    created_at      TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    updated_at      TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    project_secret  STRING(MAX) NOT NULL DEFAULT ('') CHECK (project_secret != ''),
    preview_secret  STRING(MAX) NOT NULL DEFAULT ('') CHECK (preview_secret != ''),
    preview_origins STRING(MAX) NOT NULL DEFAULT ('[]'),
) PRIMARY KEY (id)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
DROP TABLE IF EXISTS projects
-- +goose StatementEnd
