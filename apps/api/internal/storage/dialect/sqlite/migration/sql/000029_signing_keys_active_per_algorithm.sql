-- +goose Up
-- See the postgres peer (000042_signing_keys_active_per_algorithm.sql). The
-- generated column active_token_signing_key_project_id stays as it is: it
-- holds the project_id while a row is an active token key and NULL otherwise,
-- so the partial index below leaves every other row out.
-- +goose StatementBegin
CREATE UNIQUE INDEX idx_signing_keys_active_token_signing_key_algorithm
    ON signing_keys (active_token_signing_key_project_id, algorithm)
    WHERE active_token_signing_key_project_id IS NOT NULL;
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_signing_keys_active_token_signing_key;
-- +goose StatementEnd

-- +goose Down
-- Fails while a project holds active token keys of more than one algorithm.
-- +goose StatementBegin
CREATE UNIQUE INDEX idx_signing_keys_active_token_signing_key
    ON signing_keys (active_token_signing_key_project_id)
    WHERE active_token_signing_key_project_id IS NOT NULL;
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_signing_keys_active_token_signing_key_algorithm;
-- +goose StatementEnd
