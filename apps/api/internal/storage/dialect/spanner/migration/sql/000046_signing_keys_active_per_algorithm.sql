-- +goose NO TRANSACTION
-- +goose Up
-- See the postgres peer (000042_signing_keys_active_per_algorithm.sql). The
-- generated column active_token_signing_key_project_id stays as it is: it
-- holds the project_id while a row is an active token key and NULL otherwise,
-- and NULL_FILTERED leaves the rows where it is NULL out of the index.
-- +goose StatementBegin
CREATE UNIQUE NULL_FILTERED INDEX idx_signing_keys_active_token_signing_key_algorithm
    ON signing_keys (active_token_signing_key_project_id, algorithm)
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX idx_signing_keys_active_token_signing_key
-- +goose StatementEnd

-- +goose Down
-- Fails while a project holds active token keys of more than one algorithm.
-- +goose StatementBegin
CREATE UNIQUE NULL_FILTERED INDEX idx_signing_keys_active_token_signing_key
    ON signing_keys (active_token_signing_key_project_id)
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX idx_signing_keys_active_token_signing_key_algorithm
-- +goose StatementEnd
