-- Token revocation (ADR 037): a revoked token is marked inactive rather than
-- deleted, so a replayed token stays distinguishable from an unknown one.
-- Project and preview secrets become storable so a leaked one can be revoked
-- (ADR 036); they authenticate software, so they carry no user or session id.
-- +goose NO TRANSACTION
-- +goose Up
-- +goose StatementBegin
ALTER TABLE tokens ADD COLUMN revoked_at TIMESTAMP
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE tokens DROP CONSTRAINT chk_tokens_type_identifiers
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE tokens ADD CONSTRAINT chk_tokens_type_identifiers CHECK (
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
    OR (token_type IN ('project_token', 'project_preview')
        AND user_id IS NULL
        AND session_id IS NULL AND oidc_session_id IS NULL AND saml_session_id IS NULL)
)
-- +goose StatementEnd

-- Deleting a session revokes its tokens instead of deleting them, so this
-- lookup runs against a table that only grows. Index it.
-- +goose StatementBegin
CREATE NULL_FILTERED INDEX idx_tokens_session ON tokens (project_id, session_id)
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_tokens_session
-- +goose StatementEnd

-- +goose StatementBegin
DELETE FROM tokens WHERE token_type IN ('project_token', 'project_preview')
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE tokens DROP CONSTRAINT chk_tokens_type_identifiers
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE tokens ADD CONSTRAINT chk_tokens_type_identifiers CHECK (
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
)
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE tokens DROP COLUMN revoked_at
-- +goose StatementEnd
