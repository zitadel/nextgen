-- +goose NO TRANSACTION
-- +goose Up
-- See the postgres migration.
-- +goose StatementBegin
ALTER TABLE deployment_origins DROP CONSTRAINT chk_deployment_origins_origin
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
DELETE FROM deployment_origins WHERE origin = ''
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE deployment_origins ADD CONSTRAINT chk_deployment_origins_origin CHECK (origin <> '')
-- +goose StatementEnd
