-- Token revocation (ADR 037): a revoked token is marked inactive rather than
-- deleted, so a replayed token stays distinguishable from an unknown one.
-- Project and preview secrets become storable so a leaked one can be revoked
-- (ADR 036); they authenticate software, so they carry no user or session id.
--
-- SQLite cannot alter a CHECK constraint, so the type/identifier check is
-- widened by rebuilding the table. Nothing references `tokens`, so the
-- drop-and-rename needs no foreign-key juggling.

-- +goose Up
-- +goose StatementBegin
CREATE TABLE tokens_new (
    project_id      TEXT    NOT NULL,
    token_id        TEXT    NOT NULL,
    user_id         TEXT,
    token_type      TEXT    NOT NULL,
    session_id      TEXT,
    oidc_session_id TEXT,
    saml_session_id TEXT,
    scope           TEXT    NOT NULL,
    expires_at      INTEGER,
    created_at      INTEGER NOT NULL,
    revoked_at      INTEGER,
    PRIMARY KEY (project_id, token_id),
    CONSTRAINT chk_tokens_token_id CHECK (token_id <> ''),
    CONSTRAINT fk_tokens_project
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
    CONSTRAINT fk_tokens_user
        FOREIGN KEY (project_id, user_id) REFERENCES users (project_id, id) ON DELETE CASCADE,
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
        OR (token_type IN ('project_token', 'project_preview')
            AND user_id IS NULL
            AND session_id IS NULL AND oidc_session_id IS NULL AND saml_session_id IS NULL)
    )
);
-- +goose StatementEnd

-- +goose StatementBegin
INSERT INTO tokens_new (
    project_id, token_id, user_id, token_type,
    session_id, oidc_session_id, saml_session_id,
    scope, expires_at, created_at, revoked_at
)
SELECT
    project_id, token_id, user_id, token_type,
    session_id, oidc_session_id, saml_session_id,
    scope, expires_at, created_at, NULL
FROM tokens;
-- +goose StatementEnd

-- +goose StatementBegin
DROP TABLE tokens;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE tokens_new RENAME TO tokens;
-- +goose StatementEnd

-- Deleting a session revokes its tokens instead of deleting them, so this
-- lookup runs against a table that only grows. Index it.
-- +goose StatementBegin
CREATE INDEX idx_tokens_session ON tokens (project_id, session_id)
    WHERE session_id IS NOT NULL;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_tokens_session;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE tokens_old (
    project_id      TEXT    NOT NULL,
    token_id        TEXT    NOT NULL,
    user_id         TEXT,
    token_type      TEXT    NOT NULL,
    session_id      TEXT,
    oidc_session_id TEXT,
    saml_session_id TEXT,
    scope           TEXT    NOT NULL,
    expires_at      INTEGER,
    created_at      INTEGER NOT NULL,
    PRIMARY KEY (project_id, token_id),
    CONSTRAINT chk_tokens_token_id CHECK (token_id <> ''),
    CONSTRAINT fk_tokens_project
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
    CONSTRAINT fk_tokens_user
        FOREIGN KEY (project_id, user_id) REFERENCES users (project_id, id) ON DELETE CASCADE,
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
    )
);
-- +goose StatementEnd

-- +goose StatementBegin
INSERT INTO tokens_old (
    project_id, token_id, user_id, token_type,
    session_id, oidc_session_id, saml_session_id,
    scope, expires_at, created_at
)
SELECT
    project_id, token_id, user_id, token_type,
    session_id, oidc_session_id, saml_session_id,
    scope, expires_at, created_at
FROM tokens
WHERE token_type NOT IN ('project_token', 'project_preview');
-- +goose StatementEnd

-- +goose StatementBegin
DROP TABLE tokens;
-- +goose StatementEnd

-- +goose StatementBegin
ALTER TABLE tokens_old RENAME TO tokens;
-- +goose StatementEnd
