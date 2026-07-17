-- +goose NO TRANSACTION
-- +goose Up
-- +goose StatementBegin
ALTER TABLE projects ADD COLUMN name STRING(MAX) NOT NULL DEFAULT ('')
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
ALTER TABLE projects DROP COLUMN name
-- +goose StatementEnd