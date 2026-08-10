-- Token revocation (ADR 037): revoking a token deletes its record, so the
-- verifier stops resolving it and the table keeps no rows that grant nothing.
-- Project and preview secrets become storable so a leaked one can be revoked
-- (ADR 036); they authenticate software, so they carry no user or session id.
--
-- NO TRANSACTION: a value added by ALTER TYPE ... ADD VALUE cannot be used by
-- a later statement in the same transaction, and the CHECK below names both
-- new values.
-- +goose NO TRANSACTION
-- +goose Up
-- +goose StatementBegin
ALTER TYPE zitadel_nextgen.token_types ADD VALUE IF NOT EXISTS 'project_token';
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TYPE zitadel_nextgen.token_types ADD VALUE IF NOT EXISTS 'project_preview';
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE zitadel_nextgen.tokens
    DROP CONSTRAINT IF EXISTS chk_tokens_type_identifiers;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE zitadel_nextgen.tokens
    ADD CONSTRAINT chk_tokens_type_identifiers CHECK (
        (token_type = 'session_token'::zitadel_nextgen.token_types
            AND session_id IS NOT NULL
            AND oidc_session_id IS NULL AND saml_session_id IS NULL)
        OR (token_type = 'oidc_access_token'::zitadel_nextgen.token_types
            AND oidc_session_id IS NOT NULL
            AND session_id IS NULL AND saml_session_id IS NULL)
        OR (token_type = 'saml_assertion'::zitadel_nextgen.token_types
            AND saml_session_id IS NOT NULL
            AND session_id IS NULL AND oidc_session_id IS NULL)
        OR (token_type = 'personal_access_token'::zitadel_nextgen.token_types
            AND session_id IS NULL AND oidc_session_id IS NULL AND saml_session_id IS NULL)
        OR (token_type IN (
                'project_token'::zitadel_nextgen.token_types,
                'project_preview'::zitadel_nextgen.token_types)
            AND user_id IS NULL
            AND session_id IS NULL AND oidc_session_id IS NULL AND saml_session_id IS NULL)
    );
-- +goose StatementEnd

-- Deleting a session deletes the tokens it issued, which is a lookup by
-- session rather than by primary key. Index it.
-- +goose StatementBegin
CREATE INDEX IF NOT EXISTS idx_tokens_session
    ON zitadel_nextgen.tokens (project_id, session_id)
    WHERE session_id IS NOT NULL;
-- +goose StatementEnd

-- +goose Down
-- +goose NO TRANSACTION
-- +goose StatementBegin
DROP INDEX IF EXISTS zitadel_nextgen.idx_tokens_session;
-- +goose StatementEnd

-- +goose StatementBegin
DELETE FROM zitadel_nextgen.tokens
    WHERE token_type IN (
        'project_token'::zitadel_nextgen.token_types,
        'project_preview'::zitadel_nextgen.token_types);
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE zitadel_nextgen.tokens
    DROP CONSTRAINT IF EXISTS chk_tokens_type_identifiers;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE zitadel_nextgen.tokens
    ADD CONSTRAINT chk_tokens_type_identifiers CHECK (
        (token_type = 'session_token'::zitadel_nextgen.token_types
            AND session_id IS NOT NULL
            AND oidc_session_id IS NULL AND saml_session_id IS NULL)
        OR (token_type = 'oidc_access_token'::zitadel_nextgen.token_types
            AND oidc_session_id IS NOT NULL
            AND session_id IS NULL AND saml_session_id IS NULL)
        OR (token_type = 'saml_assertion'::zitadel_nextgen.token_types
            AND saml_session_id IS NOT NULL
            AND session_id IS NULL AND oidc_session_id IS NULL)
        OR (token_type = 'personal_access_token'::zitadel_nextgen.token_types
            AND session_id IS NULL AND oidc_session_id IS NULL AND saml_session_id IS NULL)
    );
-- +goose StatementEnd
