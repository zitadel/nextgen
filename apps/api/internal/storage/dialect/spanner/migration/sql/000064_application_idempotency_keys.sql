-- +goose NO TRANSACTION
-- +goose Up
-- +goose StatementBegin
-- See the postgres migration.
CREATE TABLE application_idempotency_keys (
    project_id      STRING(MAX)        NOT NULL,
    key_hash        STRING(MAX)        NOT NULL,
    request_hash    STRING(MAX)        NOT NULL,
    application_id  STRING(MAX)        NOT NULL,
    created         BOOL               NOT NULL,
    client_ids      ARRAY<STRING(MAX)> NOT NULL,
    created_at      TIMESTAMP          NOT NULL,
    expires_at      TIMESTAMP          NOT NULL,
    CONSTRAINT chk_application_idempotency_keys_key_hash CHECK (key_hash <> ''),
    CONSTRAINT fk_application_idempotency_keys_application
        FOREIGN KEY (project_id, application_id)
        REFERENCES applications (project_id, id)
        ON DELETE CASCADE,
) PRIMARY KEY (project_id, key_hash)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
DROP TABLE IF EXISTS application_idempotency_keys
-- +goose StatementEnd
