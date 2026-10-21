-- +goose Up
-- See the postgres peer (000035_users_schema_url_index.sql).
-- +goose StatementBegin
CREATE INDEX idx_users_schema_url ON users (project_id, schema_url);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_users_schema_url;
-- +goose StatementEnd
