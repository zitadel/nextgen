-- +goose Up
-- See the postgres peer (000039_user_unique_attribute_indexes.sql) for the
-- measurements.

-- +goose StatementBegin
-- Serves the lookup without a team scope. user_id trails so the lookup reads
-- the index alone.
CREATE INDEX idx_user_unique_attributes_lookup
    ON user_unique_attributes (project_id, key, value_hash, user_id);
-- +goose StatementEnd

-- +goose StatementBegin
-- Serves the cascade from users.
CREATE INDEX idx_user_unique_attributes_user ON user_unique_attributes (project_id, user_id);
-- +goose StatementEnd

-- +goose StatementBegin
-- Serves the cascade from users.
CREATE INDEX idx_tokens_user ON tokens (project_id, user_id);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_tokens_user;
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_user_unique_attributes_user;
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_user_unique_attributes_lookup;
-- +goose StatementEnd
