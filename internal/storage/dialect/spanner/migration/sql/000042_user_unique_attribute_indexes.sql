-- +goose NO TRANSACTION
-- +goose Up
-- See the postgres peer (000039_user_unique_attribute_indexes.sql) for the
-- measurements. Spanner needs only the lookup index: the foreign keys from
-- user_unique_attributes and tokens to users already have managed backing
-- indexes on (project_id, user_id), which serve the cascade.

-- +goose StatementBegin
-- Serves the lookup without a team scope. With a team scope the primary key
-- already seeks.
CREATE INDEX idx_user_unique_attributes_lookup
    ON user_unique_attributes (project_id, key, value_hash) STORING (user_id)
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_user_unique_attributes_lookup
-- +goose StatementEnd
