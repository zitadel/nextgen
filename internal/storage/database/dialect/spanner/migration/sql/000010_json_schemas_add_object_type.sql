-- +goose NO TRANSACTION
-- +goose Up
-- +goose StatementBegin
ALTER TABLE json_schemas
ADD COLUMN object_type STRING(256)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
ALTER TABLE json_schemas
DROP COLUMN object_type
-- +goose StatementEnd
