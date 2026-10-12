-- +goose NO TRANSACTION
-- +goose Up
-- Rename preview_origins → origins. Wire content becomes {pattern, kind}[];
-- UnmarshalOrigins still accepts legacy string[] on read.
-- +goose StatementBegin
ALTER TABLE projects ADD COLUMN origins STRING(MAX)
-- +goose StatementEnd
-- +goose StatementBegin
UPDATE projects SET origins = COALESCE(preview_origins, '[]') WHERE TRUE
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE projects ALTER COLUMN origins STRING(MAX) NOT NULL
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE projects DROP COLUMN preview_origins
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
ALTER TABLE projects ADD COLUMN preview_origins STRING(MAX)
-- +goose StatementEnd
-- +goose StatementBegin
UPDATE projects SET preview_origins = origins WHERE TRUE
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE projects ALTER COLUMN preview_origins STRING(MAX) NOT NULL
-- +goose StatementEnd
-- +goose StatementBegin
ALTER TABLE projects DROP COLUMN origins
-- +goose StatementEnd
