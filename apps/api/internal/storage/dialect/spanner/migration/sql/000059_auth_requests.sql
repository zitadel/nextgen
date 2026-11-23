-- +goose NO TRANSACTION
-- +goose Up
-- +goose StatementBegin
-- An authorization request; see the postgres migration.
CREATE TABLE auth_requests (
    project_id      STRING(MAX)        NOT NULL,
    id              STRING(MAX)        NOT NULL,
    client_id       STRING(MAX)        NOT NULL,
    redirect_uri    STRING(MAX)        NOT NULL,
    state           STRING(MAX)        NOT NULL,
    scopes          ARRAY<STRING(MAX)> NOT NULL,
    code_challenge  STRING(MAX)        NOT NULL,
    issuer          STRING(MAX)        NOT NULL,
    deployment_id   STRING(MAX)        NOT NULL,
    release_id      STRING(MAX)        NOT NULL,
    binding_hash    STRING(MAX)        NOT NULL,
    created_at      TIMESTAMP          NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    expires_at      TIMESTAMP          NOT NULL,
    code_hash       STRING(MAX),
    user_id         STRING(MAX),
    session_id      STRING(MAX),
    code_expires_at TIMESTAMP,
    CONSTRAINT chk_auth_requests_id CHECK (id <> ''),
    CONSTRAINT fk_auth_requests_project
        FOREIGN KEY (project_id)
        REFERENCES projects (id)
        ON DELETE CASCADE,
) PRIMARY KEY (project_id, id)
-- +goose StatementEnd

-- NULL_FILTERED: Spanner indexes NULL as a value, so every request without a
-- code would collide on (project_id, NULL).
-- +goose StatementBegin
CREATE UNIQUE NULL_FILTERED INDEX uq_auth_requests_code_hash
    ON auth_requests (project_id, code_hash)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
DROP INDEX IF EXISTS uq_auth_requests_code_hash
-- +goose StatementEnd

-- +goose StatementBegin
DROP TABLE IF EXISTS auth_requests
-- +goose StatementEnd
