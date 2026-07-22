-- +goose NO TRANSACTION
-- +goose Up
-- Spanner cannot add a NOT NULL column to an existing table in one step, so add
-- it nullable first and then tighten it to NOT NULL (safe because the table has
-- no rows without a name yet).
-- +goose StatementBegin
ALTER TABLE projects ADD COLUMN name STRING(MAX)
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE projects ALTER COLUMN name STRING(MAX) NOT NULL
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
ALTER TABLE projects DROP COLUMN name
-- +goose StatementEnd