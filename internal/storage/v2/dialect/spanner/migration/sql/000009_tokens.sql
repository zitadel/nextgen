-- +goose NO TRANSACTION
-- +goose Up
-- +goose StatementBegin
CREATE TABLE tokens (
    project_id  STRING(MAX) NOT NULL,
    token_id    STRING(MAX) NOT NULL,
    user_id     STRING(MAX),
    token_type  STRING(MAX) NOT NULL,
    session_id  STRING(MAX),
    oidc_session_id STRING(MAX),
    saml_session_id STRING(MAX),
    scope       ARRAY<STRING(MAX)> NOT NULL,
    expires_at  TIMESTAMP,
    created_at  TIMESTAMP   NOT NULL DEFAULT (CURRENT_TIMESTAMP()),
    CONSTRAINT fk_tokens_project
        FOREIGN KEY (project_id)
        REFERENCES projects (id)
        ON DELETE CASCADE,
    CONSTRAINT fk_tokens_user
        FOREIGN KEY (project_id, user_id)
        REFERENCES users (project_id, id)
        ON DELETE CASCADE,
    CONSTRAINT chk_tokens_type_identifiers CHECK (
        (token_type = 'session_token'
            AND session_id IS NOT NULL
            AND oidc_session_id IS NULL AND saml_session_id IS NULL)
        OR (token_type = 'oidc_access_token'
            AND oidc_session_id IS NOT NULL
            AND session_id IS NULL AND saml_session_id IS NULL)
        OR (token_type = 'saml_assertion'
            AND saml_session_id IS NOT NULL
            AND session_id IS NULL AND oidc_session_id IS NULL)
        OR (token_type = 'personal_access_token'
            AND session_id IS NULL AND oidc_session_id IS NULL AND saml_session_id IS NULL)
    ),
) PRIMARY KEY (project_id, token_id)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
DROP TABLE IF EXISTS tokens
-- +goose StatementEnd
