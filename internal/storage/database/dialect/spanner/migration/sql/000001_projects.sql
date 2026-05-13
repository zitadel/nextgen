-- +goose NO TRANSACTION
-- +goose Up
-- +goose StatementBegin
CREATE TABLE projects (
    id          STRING(MAX) NOT NULL,
    created_at  TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    updated_at  TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
) PRIMARY KEY (id)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
DROP TABLE IF EXISTS projects
-- +goose StatementEnd
