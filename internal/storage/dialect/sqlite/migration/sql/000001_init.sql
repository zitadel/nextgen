-- +goose Up

-- +goose StatementBegin
CREATE TABLE projects (
    id              TEXT    NOT NULL,
    name            TEXT    NOT NULL,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    preview_origins TEXT    NOT NULL,
    PRIMARY KEY (id)
);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE teams (
    project_id  TEXT    NOT NULL,
    id          TEXT    NOT NULL,
    name        TEXT    NOT NULL,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    status      TEXT    NOT NULL DEFAULT ('active'),
    name_lower  TEXT    GENERATED ALWAYS AS (LOWER(name)) STORED,
    PRIMARY KEY (project_id, id),
    CONSTRAINT chk_teams_name CHECK (name <> '' AND length(name) <= 200),
    CONSTRAINT fk_teams_project
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE UNIQUE INDEX idx_teams_project_name ON teams (project_id, name_lower);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE json_schemas (
    project_id  TEXT    NOT NULL,
    url         TEXT    NOT NULL,
    object_type TEXT,
    created_at  INTEGER NOT NULL,
    payload     TEXT    NOT NULL,
    PRIMARY KEY (project_id, url),
    CONSTRAINT fk_json_schemas_project
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE users (
    project_id               TEXT    NOT NULL,
    id                       TEXT    NOT NULL,
    schema_url               TEXT    NOT NULL,
    lifecycle_owner_team_id  TEXT,
    status                   TEXT    NOT NULL DEFAULT ('active'),
    created_at               INTEGER NOT NULL,
    updated_at               INTEGER NOT NULL,
    PRIMARY KEY (project_id, id),
    CONSTRAINT fk_users_project
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE user_attributes (
    project_id  TEXT NOT NULL,
    team_id     TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    key         TEXT NOT NULL,
    value       TEXT NOT NULL,
    PRIMARY KEY (project_id, user_id, key),
    CONSTRAINT fk_user_attributes_user
        FOREIGN KEY (project_id, user_id) REFERENCES users (project_id, id) ON DELETE CASCADE
);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_user_attributes_scalar ON user_attributes (key, team_id);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_user_attributes_team_id ON user_attributes (team_id);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE user_unique_attributes (
    project_id  TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    team_id     TEXT NOT NULL,
    key         TEXT NOT NULL,
    value_hash  BLOB NOT NULL,
    PRIMARY KEY (project_id, team_id, key, value_hash),
    CONSTRAINT fk_user_unique_attributes_user
        FOREIGN KEY (project_id, user_id) REFERENCES users (project_id, id) ON DELETE CASCADE
);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE team_memberships (
    project_id  TEXT    NOT NULL,
    team_id     TEXT    NOT NULL,
    user_id     TEXT    NOT NULL,
    status      TEXT    NOT NULL DEFAULT ('active'),
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    PRIMARY KEY (project_id, team_id, user_id),
    CONSTRAINT fk_team_memberships_project
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
    -- teams/users stay RESTRICT (ADR 024: team/user deletion goes through a
    -- lifecycle service, not a raw cascade); project deletion gets its own path.
    CONSTRAINT fk_team_memberships_team
        FOREIGN KEY (project_id, team_id) REFERENCES teams (project_id, id) ON DELETE RESTRICT,
    CONSTRAINT fk_team_memberships_user
        FOREIGN KEY (project_id, user_id) REFERENCES users (project_id, id) ON DELETE RESTRICT
);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_team_memberships_user ON team_memberships (project_id, user_id);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE flow_definitions (
    project_id      TEXT    NOT NULL,
    id              TEXT    NOT NULL,
    name            TEXT    NOT NULL,
    schema_version  TEXT    NOT NULL,
    status          TEXT    NOT NULL DEFAULT ('draft'),
    purposes        TEXT    NOT NULL,
    definition      TEXT    NOT NULL,
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    PRIMARY KEY (project_id, id),
    CONSTRAINT fk_flow_definitions_project
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_flow_definitions_project_status ON flow_definitions (project_id, status);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE auth_attempts (
    project_id      TEXT    NOT NULL,
    id              TEXT    NOT NULL,
    handoff_token   BLOB,
    handed_off_at   INTEGER,
    session_id      TEXT,
    required_checks TEXT,
    created_at      INTEGER NOT NULL,
    time_to_live    INTEGER,
    PRIMARY KEY (project_id, id),
    CONSTRAINT chk_auth_attempts_id CHECK (id <> ''),
    CONSTRAINT fk_auth_attempts_project
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE UNIQUE INDEX idx_auth_attempts_handoff_token
    ON auth_attempts (project_id, handoff_token)
    WHERE handoff_token IS NOT NULL;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE user_agents (
    project_id  TEXT    NOT NULL,
    id          TEXT    NOT NULL,
    info        TEXT    NOT NULL,
    created_at  INTEGER,
    updated_at  INTEGER,
    PRIMARY KEY (project_id, id),
    CONSTRAINT chk_user_agents_id CHECK (id <> ''),
    CONSTRAINT fk_user_agents_project
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE tokens (
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
        OR (token_type IN ('project_token', 'project_preview')
            AND user_id IS NULL
            AND session_id IS NULL AND oidc_session_id IS NULL AND saml_session_id IS NULL)
    )
);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_tokens_session ON tokens (project_id, session_id)
    WHERE session_id IS NOT NULL;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE sessions (
    project_id    TEXT    NOT NULL,
    id            TEXT    NOT NULL,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL,
    time_to_live  INTEGER NOT NULL,
    expires_at    INTEGER GENERATED ALWAYS AS (updated_at + time_to_live) STORED,
    token_id      TEXT,
    user_id       TEXT,
    user_agent_id TEXT,
    PRIMARY KEY (project_id, id),
    CONSTRAINT chk_sessions_id CHECK (id <> ''),
    CONSTRAINT fk_sessions_project
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE,
    CONSTRAINT fk_sessions_user
        FOREIGN KEY (project_id, user_id) REFERENCES users (project_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_sessions_user_agent
        FOREIGN KEY (project_id, user_agent_id) REFERENCES user_agents (project_id, id)
);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE UNIQUE INDEX idx_sessions_token
    ON sessions (project_id, token_id)
    WHERE token_id IS NOT NULL;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE checks (
    project_id          TEXT    NOT NULL,
    id                  TEXT    NOT NULL,
    auth_attempt_id     TEXT,
    session_id          TEXT,
    type                INTEGER NOT NULL,
    last_challenged_at  INTEGER,
    last_verified_at    INTEGER,
    last_failed_at      INTEGER,
    failure_count       INTEGER NOT NULL DEFAULT (0),
    challenge_payload   TEXT,
    factor_payload      TEXT,
    PRIMARY KEY (project_id, id),
    CONSTRAINT chk_checks_id CHECK (id <> ''),
    CONSTRAINT fk_checks_auth_attempt
        FOREIGN KEY (project_id, auth_attempt_id) REFERENCES auth_attempts (project_id, id) ON DELETE CASCADE,
    CONSTRAINT fk_checks_session
        FOREIGN KEY (project_id, session_id) REFERENCES sessions (project_id, id) ON DELETE CASCADE
);
-- +goose StatementEnd

-- +goose StatementBegin
-- Supports ON CONFLICT (project_id, auth_attempt_id, type) in SetAuthAttemptChallenge.
-- NULLs are considered distinct so rows with auth_attempt_id=NULL do not conflict.
CREATE UNIQUE INDEX idx_checks_auth_attempt_type
    ON checks (project_id, auth_attempt_id, type);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_checks_session ON checks (project_id, session_id);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE encryption_keys (
    project_id                                 TEXT    NOT NULL,
    id                                         TEXT    NOT NULL,
    key                                        TEXT    NOT NULL,
    algorithm                                  TEXT    NOT NULL,
    state                                      TEXT    NOT NULL,
    created_at                                 INTEGER NOT NULL,
    activated_at                               INTEGER,
    retired_at                                 INTEGER,
    purpose                                    TEXT    NOT NULL,
    -- Generated columns hold project_id only while the row is the project's
    -- active key for that purpose (NULL otherwise). Paired with the partial
    -- unique indexes below they enforce "at most one active key per
    -- (project, purpose)" — SQLite's equivalent of Spanner NULL_FILTERED
    -- unique indexes / postgres partial unique indexes.
    active_kek_project_id                      TEXT GENERATED ALWAYS AS (
        CASE WHEN state = 'active' AND purpose = 'kek' THEN project_id ELSE NULL END
    ) STORED,
    active_token_encryption_key_project_id     TEXT GENERATED ALWAYS AS (
        CASE WHEN state = 'active' AND purpose = 'token' THEN project_id ELSE NULL END
    ) STORED,
    active_secret_encryption_key_project_id    TEXT GENERATED ALWAYS AS (
        CASE WHEN state = 'active' AND purpose = 'secret' THEN project_id ELSE NULL END
    ) STORED,
    active_cookie_encryption_key_project_id    TEXT GENERATED ALWAYS AS (
        CASE WHEN state = 'active' AND purpose = 'cookie' THEN project_id ELSE NULL END
    ) STORED,
    PRIMARY KEY (project_id, id),
    CONSTRAINT chk_encryption_keys_id      CHECK (id <> ''),
    CONSTRAINT chk_encryption_keys_key     CHECK (key <> ''),
    CONSTRAINT chk_encryption_keys_algo    CHECK (algorithm <> ''),
    CONSTRAINT chk_encryption_keys_state   CHECK (state <> ''),
    CONSTRAINT chk_encryption_keys_purpose CHECK (purpose <> ''),
    CONSTRAINT fk_encryption_keys_project
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE UNIQUE INDEX idx_encryption_keys_active_kek
    ON encryption_keys (active_kek_project_id)
    WHERE active_kek_project_id IS NOT NULL;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX idx_encryption_keys_active_token_encryption_key
    ON encryption_keys (active_token_encryption_key_project_id)
    WHERE active_token_encryption_key_project_id IS NOT NULL;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX idx_encryption_keys_active_secret_encryption_key
    ON encryption_keys (active_secret_encryption_key_project_id)
    WHERE active_secret_encryption_key_project_id IS NOT NULL;
-- +goose StatementEnd
-- +goose StatementBegin
CREATE UNIQUE INDEX idx_encryption_keys_active_cookie_encryption_key
    ON encryption_keys (active_cookie_encryption_key_project_id)
    WHERE active_cookie_encryption_key_project_id IS NOT NULL;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE signing_keys (
    project_id                          TEXT    NOT NULL,
    id                                  TEXT    NOT NULL,
    key                                 TEXT    NOT NULL,
    algorithm                           TEXT    NOT NULL,
    state                               TEXT    NOT NULL,
    created_at                          INTEGER NOT NULL,
    activated_at                        INTEGER,
    retired_at                          INTEGER,
    purpose                             TEXT    NOT NULL,
    active_token_signing_key_project_id TEXT GENERATED ALWAYS AS (
        CASE WHEN state = 'active' AND purpose = 'token' THEN project_id ELSE NULL END
    ) STORED,
    PRIMARY KEY (project_id, id),
    CONSTRAINT chk_signing_keys_id      CHECK (id <> ''),
    CONSTRAINT chk_signing_keys_key     CHECK (key <> ''),
    CONSTRAINT chk_signing_keys_algo    CHECK (algorithm <> ''),
    CONSTRAINT chk_signing_keys_state   CHECK (state <> ''),
    CONSTRAINT chk_signing_keys_purpose CHECK (purpose <> ''),
    CONSTRAINT fk_signing_keys_project
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE UNIQUE INDEX idx_signing_keys_active_token_signing_key
    ON signing_keys (active_token_signing_key_project_id)
    WHERE active_token_signing_key_project_id IS NOT NULL;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE branding (
    project_id  TEXT    NOT NULL,
    id          TEXT    NOT NULL,
    definition  TEXT,
    created_at  INTEGER NOT NULL,
    PRIMARY KEY (project_id, id),
    CONSTRAINT fk_branding_project
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_branding_project_created_at ON branding (project_id, created_at DESC, id DESC);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE passkey_registrations (
    id          TEXT    NOT NULL,
    project_id  TEXT    NOT NULL,
    user_id     TEXT    NOT NULL,
    challenge   TEXT    NOT NULL,
    expires_at  INTEGER NOT NULL,
    created_at  INTEGER NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT fk_passkey_registrations_project
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_passkey_registrations_expires_at ON passkey_registrations (expires_at);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE claim_challenges (
    -- id is the SHA-256 hash of a handoff-token-style challenge token minted in
    -- Go (ADR 041 §3); the plaintext travels outside the system, only the hash
    -- is stored. Application-supplied, hence no DB default.
    id                     TEXT    NOT NULL,
    project_id             TEXT    NOT NULL,
    -- SHA-256 of the project secret that initiated the claim; proves possession
    -- on claim/status (see Claim E1).
    initiating_secret_hash TEXT    NOT NULL,
    status                 TEXT    NOT NULL DEFAULT ('pending'),
    expires_at             INTEGER NOT NULL,
    created_at             INTEGER NOT NULL,
    PRIMARY KEY (id),
    CONSTRAINT chk_claim_challenges_id CHECK (id <> ''),
    CONSTRAINT chk_claim_challenges_status CHECK (status IN ('pending', 'completed')),
    CONSTRAINT fk_claim_challenges_project
        FOREIGN KEY (project_id) REFERENCES projects (id) ON DELETE CASCADE
);
-- +goose StatementEnd

-- +goose StatementBegin
-- Serves a future expiry sweep; automated expiry enforcement itself is out of
-- scope for this epic (ADR 041 §6).
CREATE INDEX idx_claim_challenges_expires_at ON claim_challenges (expires_at);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE INDEX idx_claim_challenges_project_id ON claim_challenges (project_id);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE user_passwords (
    project_id            TEXT    NOT NULL,
    id                    TEXT    NOT NULL,
    user_id               TEXT    NOT NULL,
    encoded_hash          TEXT    NOT NULL,
    change_required       INTEGER NOT NULL DEFAULT (0),
    changed_at            INTEGER NOT NULL,
    verification_id       TEXT,
    last_successful_check INTEGER,
    failed_attempts       INTEGER NOT NULL DEFAULT (0),
    created_at            INTEGER NOT NULL,
    updated_at            INTEGER NOT NULL,
    PRIMARY KEY (project_id, id),
    CONSTRAINT chk_user_passwords_id CHECK (id <> ''),
    CONSTRAINT chk_user_passwords_encoded_hash CHECK (encoded_hash <> ''),
    CONSTRAINT chk_user_passwords_failed_attempts CHECK (failed_attempts >= 0),
    CONSTRAINT fk_user_passwords_user
        FOREIGN KEY (project_id, user_id) REFERENCES users (project_id, id) ON DELETE CASCADE
);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE UNIQUE INDEX idx_user_passwords_user ON user_passwords (project_id, user_id);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE user_totp (
    project_id            TEXT    NOT NULL,
    id                    TEXT    NOT NULL,
    user_id               TEXT    NOT NULL,
    secret                BLOB    NOT NULL,
    verified_at           INTEGER,
    last_successful_check INTEGER,
    failed_attempts       INTEGER NOT NULL DEFAULT (0),
    created_at            INTEGER NOT NULL,
    updated_at            INTEGER NOT NULL,
    PRIMARY KEY (project_id, id),
    CONSTRAINT chk_user_totp_id CHECK (id <> ''),
    CONSTRAINT chk_user_totp_failed_attempts CHECK (failed_attempts >= 0),
    CONSTRAINT fk_user_totp_user
        FOREIGN KEY (project_id, user_id) REFERENCES users (project_id, id) ON DELETE CASCADE
);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE UNIQUE INDEX idx_user_totp_user ON user_totp (project_id, user_id);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE user_recovery_codes (
    project_id            TEXT    NOT NULL,
    id                    TEXT    NOT NULL,
    user_id               TEXT    NOT NULL,
    recovery_codes        TEXT    NOT NULL,
    last_successful_check INTEGER,
    failed_attempts       INTEGER NOT NULL DEFAULT (0),
    created_at            INTEGER NOT NULL,
    updated_at            INTEGER NOT NULL,
    PRIMARY KEY (project_id, id),
    CONSTRAINT chk_user_recovery_codes_id CHECK (id <> ''),
    CONSTRAINT chk_user_recovery_codes_nonempty CHECK (json_array_length(recovery_codes) > 0),
    CONSTRAINT fk_user_recovery_codes_user
        FOREIGN KEY (project_id, user_id) REFERENCES users (project_id, id) ON DELETE CASCADE
);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE UNIQUE INDEX idx_user_recovery_codes_user ON user_recovery_codes (project_id, user_id);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE TABLE user_passkeys (
    project_id       TEXT    NOT NULL,
    id               TEXT    NOT NULL,
    user_id          TEXT    NOT NULL,
    credential_id    TEXT    NOT NULL,
    public_key       BLOB    NOT NULL,
    aaguid           BLOB,
    attestation_type TEXT,
    transports       TEXT    NOT NULL,
    sign_count       INTEGER NOT NULL DEFAULT (0),
    backup_eligible  INTEGER NOT NULL DEFAULT (0),
    backup_state     INTEGER NOT NULL DEFAULT (0),
    name             TEXT,
    verified_at      INTEGER,
    last_used_at     INTEGER,
    created_at       INTEGER NOT NULL,
    updated_at       INTEGER NOT NULL,
    PRIMARY KEY (project_id, id),
    CONSTRAINT chk_user_passkeys_id CHECK (id <> ''),
    CONSTRAINT chk_user_passkeys_credential_id CHECK (credential_id <> ''),
    CONSTRAINT chk_user_passkeys_sign_count    CHECK (sign_count >= 0),
    CONSTRAINT fk_user_passkeys_user
        FOREIGN KEY (project_id, user_id) REFERENCES users (project_id, id) ON DELETE CASCADE
);
-- +goose StatementEnd

-- +goose StatementBegin
CREATE UNIQUE INDEX idx_user_passkeys_credential
    ON user_passkeys (project_id, user_id, credential_id);
-- +goose StatementEnd

-- +goose Down

-- +goose StatementBegin
DROP INDEX IF EXISTS idx_user_passkeys_credential;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS user_passkeys;
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_user_recovery_codes_user;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS user_recovery_codes;
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_user_totp_user;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS user_totp;
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_user_passwords_user;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS user_passwords;
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_claim_challenges_project_id;
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_claim_challenges_expires_at;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS claim_challenges;
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_passkey_registrations_expires_at;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS passkey_registrations;
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_branding_project_created_at;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS branding;
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_signing_keys_active_token_signing_key;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS signing_keys;
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_encryption_keys_active_cookie_encryption_key;
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_encryption_keys_active_secret_encryption_key;
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_encryption_keys_active_token_encryption_key;
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_encryption_keys_active_kek;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS encryption_keys;
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_checks_session;
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_checks_auth_attempt_type;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS checks;
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_sessions_token;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS sessions;
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_tokens_session;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS tokens;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS user_agents;
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_auth_attempts_handoff_token;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS auth_attempts;
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_flow_definitions_project_status;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS flow_definitions;
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_team_memberships_user;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS team_memberships;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS user_unique_attributes;
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_user_attributes_team_id;
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_user_attributes_scalar;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS user_attributes;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS users;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS json_schemas;
-- +goose StatementEnd
-- +goose StatementBegin
DROP INDEX IF EXISTS idx_teams_project_name;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS teams;
-- +goose StatementEnd
-- +goose StatementBegin
DROP TABLE IF EXISTS projects;
-- +goose StatementEnd
