-- +goose Up
-- +goose StatementBegin
-- See the postgres migration. client_ids is a JSON array, as
-- auth_requests.scopes is; times are unix nanos set in Go.
CREATE TABLE application_idempotency_keys (
    project_id      TEXT    NOT NULL,
    key_hash        TEXT    NOT NULL,
    request_hash    TEXT    NOT NULL,
    application_id  TEXT    NOT NULL,
    created         INTEGER NOT NULL,
    client_ids      TEXT    NOT NULL,
    created_at      INTEGER NOT NULL,
    expires_at      INTEGER NOT NULL,
    PRIMARY KEY (project_id, key_hash),
    CONSTRAINT chk_application_idempotency_keys_key_hash CHECK (key_hash <> ''),
    CONSTRAINT fk_application_idempotency_keys_application
        FOREIGN KEY (project_id, application_id)
        REFERENCES applications (project_id, id) ON DELETE CASCADE
);
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP TABLE IF EXISTS application_idempotency_keys;
-- +goose StatementEnd
